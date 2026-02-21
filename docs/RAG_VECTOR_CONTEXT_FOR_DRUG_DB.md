# RAG + Pricing Context (Drug DB)

## Purpose
เอกสารนี้ใช้เป็น context พื้นฐานให้ Codex/ทีมในอีกโปรเจกต์ เพื่อออกแบบ AI chatbot (RAG) ที่ตอบได้ดีและคำนวณราคา/จำนวนยาได้แม่นยำ

## Core Decision (สำคัญ)
- ไม่แปลงทั้งฐานข้อมูลเป็น Vector DB
- ใช้แนวทาง Hybrid:
  - Relational DB (`PostgreSQL`) = source of truth สำหรับข้อมูลธุรกรรมและการคำนวณ
  - Vector DB (หรือ `pgvector`) = semantic retrieval จากข้อความ

## What goes into Vector DB
ใส่เฉพาะข้อมูลที่ต้องค้นหาเชิงความหมาย (semantic):
- `skus.display_name`
- `skus.generic_name`
- `skus.strength_text`
- `skus.form`
- `skus.route`
- `skus.category_name`
- ข้อความ guideline/monograph/FAQ/clinical notes (ถ้ามี)

> หมายเหตุ: `skus` ควรเป็น anchor สำหรับ mapping ไป `sku_id` แต่ไม่ใช่แหล่งคำนวณราคา/จำนวนโดยตรง

## What should NOT go into Vector DB (for calculation)
ข้อมูลที่ต้องแม่นยำเชิงตัวเลข/เวลา ให้ใช้ SQL เท่านั้น:
- `prices.price`
- `prices.currency`
- `prices.effective_start`
- `prices.effective_end`
- `avg_cost`, timestamps, IDs, status flags

## Why
- Vector search เป็น approximate retrieval (มีโอกาสคลาดเคลื่อน)
- งานคำนวณบิล/ราคายา/จำนวนเม็ด ต้อง deterministic และ audit ได้

## Recommended Runtime Flow
1. ผู้ใช้ถามด้วยภาษาธรรมชาติ
2. Vector retrieval หา candidate SKU (`sku_id`) จากข้อมูล semantic
3. SQL อ่านราคา active จาก `prices` ตามช่วงเวลา
4. SQL/Rule engine คำนวณจำนวนที่ต้องจ่าย + ราคารวม
5. AI ทำหน้าที่อธิบายเหตุผลจากผลคำนวณที่ได้จากระบบ deterministic

---

## Schema Detail: `public.prices`
ตารางนี้ใช้เก็บประวัติราคาตามช่วงเวลา (time-bound pricing) ต่อ SKU

### Columns
| Column | Type | Nullable | Default | Meaning |
|---|---|---|---|---|
| `price_id` | `integer` | No | generated always as identity | PK ของรายการราคา |
| `sku_id` | `integer` | No | - | FK ไป `skus.sku_id` |
| `price` | `numeric` | Yes | - | ราคาของ SKU |
| `currency` | `text` | Yes | - | สกุลเงิน |
| `effective_start` | `timestamp without time zone` | Yes | - | วันเริ่มใช้ราคา |
| `effective_end` | `timestamp without time zone` | Yes | - | วันสิ้นสุดใช้ราคา |
| `updated_at` | `timestamp with time zone` | No | `now()` | เวลาอัปเดตข้อมูล |

### Keys / Indexes / Constraints
- Primary Key: `prices_pkey (price_id)`
- Index: `idx_prices_sku (sku_id)`
- Index: `prices_sku_effstart_idx (sku_id, effective_start DESC)`
- Foreign Key: `prices_sku_id_fkey (sku_id) REFERENCES skus(sku_id)`

### What this table does NOT contain
- ไม่เก็บ `qty_dispensed` (จำนวนที่จ่ายจริง)
- ไม่เก็บ dosing rule (เช่น mg/kg/day)
- ไม่เก็บแพ็กกิ้งเชิงคลินิกว่า 1 แผงมี x เม็ด (ต้องมาจาก SKU/pack data)

---

## Related Schema (for retrieval anchor): `public.skus` (selected fields)
ฟิลด์ที่สำคัญต่อ RAG + dispensing context:
- `sku_id` (PK)
- `item_id` (FK ไป `items`)
- `display_name`, `generic_name`, `strength_text`, `form`, `route`
- `uom`, `qty_in_base`, `pack_level`
- `category_name`, `supplier_code`, `company_code`
- `avg_cost`
- `enrichment_status` (`missing` / `partial` / `verified`)

ใช้ `sku_id` เป็นตัวเชื่อมหลักระหว่าง retrieval -> pricing -> billing.

---

## Accuracy Requirements for AI Estimation
ถ้าต้องการให้ AI ประเมินว่า "ยา 1 แผงพอไหม" หรือ "ราคาอยู่ในช่วงเฉลี่ยไหม" ควรมีข้อมูลเพิ่มแบบโครงสร้าง:
- `drug_dosing_rules` (สูตร dose ตามน้ำหนัก/อายุ/ข้อบ่งใช้)
- `sku_packaging` (เม็ดต่อแผง/หน่วยต่อกล่อง)
- `price_benchmarks` (ราคาเฉลี่ย/percentile ตามช่วงเวลาและสาขา/พื้นที่)

AI ไม่ควรคำนวณจาก embedding โดยตรง แต่ใช้ผลจาก rule + SQL แล้วจึงอธิบายเป็นภาษาธรรมชาติ.

## Hand-off Notes for Another Codex Project
- Treat PostgreSQL as authoritative for all numeric/time-based decisions.
- Use vector retrieval only for intent and product matching.
- Always resolve final `sku_id` and price via SQL before presenting totals.
- For medical/antibiotic contexts, include explicit safety checks and human review path.
