#!/usr/bin/env node
"use strict";

/**
 * Ingredient Dictionary Seed — Batch 2 (FADAsoft active ingredient list SET 2).
 *
 * Phase 4.7. Seeds the knowledge.* DICTIONARY ONLY:
 *   - knowledge.ingredients
 *   - knowledge.ingredient_synonyms
 *   - knowledge.drug_classes + knowledge.ingredient_drug_classes
 *   - knowledge.indications  + knowledge.ingredient_indications
 *   - knowledge.ingredient_category_rules (only when a clearly suitable EXISTING
 *     confirmed/imported category name exists; never invents categories)
 *
 * It does NOT touch knowledge.product_ingredients (no backfill), does NOT change
 * any API/frontend/review-queue behavior, never auto-confirms product rows, and
 * never overwrites confirmed data (synonyms/rules are insert-if-missing; class
 * and indication maps upsert source/status only).
 *
 * Idempotent. Default mode is --dry-run (everything runs inside a transaction
 * that is ROLLED BACK). Use --commit to persist. Counts are accurate in both
 * modes because the same upserts run either way.
 *
 * Usage:
 *   node scripts/seed_ingredient_dictionary_batch2.js [--dry-run] [--commit] [--db-url <url>]
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const SOURCE = "seed_dictionary_batch_2";

// Verbatim FADAsoft SET 2 input (trimmed), kept for the "total input terms" count.
const RAW_TERMS = [
  "Dicloxacillin", "ampicillin", "penicillin v potassium",
  "amoxicillin + clavulanic acid/clavulanate", "cephalexin", "cefuroxime",
  "ceifixime", "cefdinir", "cefditoren", "azithromycin", "roxithromycin",
  "clarithromycin", "chlortetracycline", "tetracycline", "doxycycline",
  "clindamycin", "nifuroxazide", "tinidazole", "metronidazole", "moxifloxacin",
  "levofloxacin", "ciprofloxacin", "ofloxacin", "norfloxacin",
  "fosfomycin trometamol", "Ibuprofen l arginine salt", "Diclofenac sodium",
  "diclofenac potassium", "naproxen", "piroxicam", "indomethacin", "loxoprofen",
  "mefenamic acid", "etodolac", "celecoxib", "meloxicam", "tenoxicam",
  "orphenadrine citrate", "tizanidine", "tolperisone", "eperisone",
  "Clotrimazole", "Triamcinolone acetonide", "Betamethasone valerate",
  "Betamethasone dipropionate", "Metformin", "simvastatin", "rosuvastatin",
  "pravastatin", "pitavastatin", "gemfibrozil", "fenofibrate", "ezetimibe",
  "Ketoconazole", "itraconazole", "fluconazole", "griseofulvin",
  "dequalinium chloride", "di-iodohydroxyquinoline", "benzalkonium chloride",
  "miconazole", "clotrimazole", "sertaconazole", "nystatin", "Etoricoxib",
  "Acetylcysteine", "chlorpheniramine maleate", "brompheniramine maleate",
  "dimenhydrinate", "diphenhydramine", "triprolidine hydrochloride",
  "doxylamine succinate", "hydroxyzine", "phenylephrine", "cyproheptadine",
  "ketotifen", "fexofenadine", "bilastine", "levocetirizine", "desloratadine",
  "Bromhexine", "ambroxol", "guaifenesin", "glyceryl guaiacolate",
  "Carbocysteine Lysine Salt Monohydrate", "carbocisteine", "Simethicone",
  "alvarine citrate", "Hyoscine butylbromide", "dicyclomine", "drotaverine",
  "domperidone", "itopride", "mosapride", "cisapride", "metoclopramide",
  "rebamipide", "Amlodipine", "enalapril", "losartan", "clopidogrel",
  "rivaroxaban", "apixaban", "aspirin", "candesartan", "valsartan", "manidipine",
  "nifedipine", "isosorbide-mononitrate", "isosorbide-dinitrate", "lercanidipine",
  "trimetazidine", "verapamil", "diltiazem", "digoxin", "atenolol", "irbesartan",
  "azilsartan", "furosemide", "acetazolamide", "hydralazine", "spironolactone",
  "hydrochlorothiazide", "amiloride", "indapamide", "metoprolol", "propranolol",
  "bisoprolol", "carvedilol", "gabapentin", "Omeprazole", "esomeprazole",
  "rabeprazole", "lansoprazole", "dexlansoprazole", "pantoprazole", "vonoprazan",
  "cimetidine", "famotidine", "Dextromethorphan", "salbutamol", "terbutaline",
  "theophylline", "montelukast", "procaterol", "levodropropizine",
];

// Corrections applied to obvious, safe typos (reported, not used as synonyms).
const CORRECTIONS = [
  { from: "ceifixime", to: "cefixime", note: "obvious misspelling of cefixime" },
  { from: "alvarine citrate", to: "alverine", note: "obvious misspelling of alverine" },
];

// Notes about combination / salt modeling decisions.
const MODELING_NOTES = [
  "amoxicillin + clavulanic acid/clavulanate modeled as 2 ingredients: amoxicillin (with combo synonyms co-amoxiclav/amoxiclav/...) and clavulanic acid (clavulanate as its salt synonym).",
  "glyceryl guaiacolate modeled as a synonym of guaifenesin (same drug).",
  "Carbocysteine Lysine Salt Monohydrate modeled as a synonym/salt of carbocisteine.",
];

// Shared category constants (verified against the live confirmed/imported set at
// runtime; any miss is auto-reported as uncertain rather than written).
const CAT = {
  ANTIBIOTIC: "2ยาฆ่าเชื้อ",
  ANTIFUNGAL: "2ยาฆ่าเชื้อรา",
  PAIN: "3ยาแก้ปวด",
  NEUROPATHIC: "3ยาแก้ปวดชา",
  MUSCLE: "3ยาคลายกล้ามเนื้อ",
  ANTIHISTAMINE: "2ยาแก้แพ้",
  COUGH: "2ยาแก้ไอ",
  MUCOLYTIC: "ละลายเสมหะ",
  ANTIFLATULENT: "ขับลม",
  ANTISPASMODIC: "4ยาปวดเกร็ง",
  ANTIEMETIC: "4แก้อาเจียน",
  PROKINETIC: "4เพิ่มการเคลี่ยนไหว",
  VERTIGO: "3ยาแก้เวียน",
  GASTROPROTECT: "เคลือบแผลในกระเพาะ",
  ANTACID: "4ยาลดกรด",
  HYPERTENSION: "7ยาความดัน",
  DIURETIC: "7ยาขับปัสสาวะ",
  ANTIPLATELET: "7ยาต้านการจับตัวของเกล็ดเลือด",
  HEART: "7ยาหัวใจ",
  LIPID: "8ยาลดไขมัน",
  DIABETES: "8ยาเบาหวาน",
  BRONCHODILATOR: "6ยาขยายหลอดลม",
  DIARRHEA: "ยาแก้ท้องเสีย",
};

// ── ingredient definitions ───────────────────────────────────────────────────
// Each: { canonical, display, synonyms[], drugClass, indications[],
//         preferredCategory|null, uncertainReason? }
const INGREDIENTS = [
  // Penicillins
  { canonical: "dicloxacillin", display: "Dicloxacillin", synonyms: ["dicloxacillin"], drugClass: "Antibiotic (Penicillin)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "ampicillin", display: "Ampicillin", synonyms: ["ampicillin"], drugClass: "Antibiotic (Penicillin)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "penicillin v potassium", display: "Penicillin V Potassium", synonyms: ["penicillin v potassium", "penicillin v", "phenoxymethylpenicillin"], drugClass: "Antibiotic (Penicillin)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "amoxicillin", display: "Amoxicillin", synonyms: ["amoxicillin", "amoxycillin", "amoxicillin clavulanic acid", "amoxicillin clavulanate", "co-amoxiclav", "amoxiclav"], drugClass: "Antibiotic (Penicillin)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "clavulanic acid", display: "Clavulanic Acid", synonyms: ["clavulanic acid", "clavulanate", "potassium clavulanate"], drugClass: "Beta-lactamase inhibitor", indications: ["Bacterial infection"], preferredCategory: null, uncertainReason: "Adjuvant component, only used combined with a penicillin — no standalone shelf category." },
  // Cephalosporins
  { canonical: "cephalexin", display: "Cephalexin", synonyms: ["cephalexin", "cefalexin"], drugClass: "Antibiotic (Cephalosporin)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "cefuroxime", display: "Cefuroxime", synonyms: ["cefuroxime", "cefuroxime axetil"], drugClass: "Antibiotic (Cephalosporin)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "cefixime", display: "Cefixime", synonyms: ["cefixime"], drugClass: "Antibiotic (Cephalosporin)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "cefdinir", display: "Cefdinir", synonyms: ["cefdinir"], drugClass: "Antibiotic (Cephalosporin)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "cefditoren", display: "Cefditoren", synonyms: ["cefditoren", "cefditoren pivoxil"], drugClass: "Antibiotic (Cephalosporin)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  // Macrolides
  { canonical: "azithromycin", display: "Azithromycin", synonyms: ["azithromycin"], drugClass: "Antibiotic (Macrolide)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "roxithromycin", display: "Roxithromycin", synonyms: ["roxithromycin"], drugClass: "Antibiotic (Macrolide)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "clarithromycin", display: "Clarithromycin", synonyms: ["clarithromycin"], drugClass: "Antibiotic (Macrolide)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  // Tetracyclines
  { canonical: "chlortetracycline", display: "Chlortetracycline", synonyms: ["chlortetracycline"], drugClass: "Antibiotic (Tetracycline)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "tetracycline", display: "Tetracycline", synonyms: ["tetracycline"], drugClass: "Antibiotic (Tetracycline)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "doxycycline", display: "Doxycycline", synonyms: ["doxycycline"], drugClass: "Antibiotic (Tetracycline)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  // Other antibacterials
  { canonical: "clindamycin", display: "Clindamycin", synonyms: ["clindamycin"], drugClass: "Antibiotic (Lincosamide)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "nifuroxazide", display: "Nifuroxazide", synonyms: ["nifuroxazide"], drugClass: "Intestinal antiseptic", indications: ["Diarrhea"], preferredCategory: CAT.DIARRHEA },
  { canonical: "tinidazole", display: "Tinidazole", synonyms: ["tinidazole"], drugClass: "Antibiotic (Nitroimidazole)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "metronidazole", display: "Metronidazole", synonyms: ["metronidazole"], drugClass: "Antibiotic (Nitroimidazole)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  // Fluoroquinolones
  { canonical: "moxifloxacin", display: "Moxifloxacin", synonyms: ["moxifloxacin"], drugClass: "Antibiotic (Fluoroquinolone)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "levofloxacin", display: "Levofloxacin", synonyms: ["levofloxacin"], drugClass: "Antibiotic (Fluoroquinolone)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "ciprofloxacin", display: "Ciprofloxacin", synonyms: ["ciprofloxacin"], drugClass: "Antibiotic (Fluoroquinolone)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "ofloxacin", display: "Ofloxacin", synonyms: ["ofloxacin"], drugClass: "Antibiotic (Fluoroquinolone)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "norfloxacin", display: "Norfloxacin", synonyms: ["norfloxacin"], drugClass: "Antibiotic (Fluoroquinolone)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "fosfomycin", display: "Fosfomycin", synonyms: ["fosfomycin", "fosfomycin trometamol"], drugClass: "Antibiotic", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  // NSAIDs / analgesics
  { canonical: "ibuprofen", display: "Ibuprofen", synonyms: ["ibuprofen", "ibuprofen arginine"], drugClass: "NSAID", indications: ["Pain", "Inflammation", "Fever"], preferredCategory: CAT.PAIN },
  { canonical: "diclofenac", display: "Diclofenac", synonyms: ["diclofenac", "diclofenac sodium", "diclofenac potassium"], drugClass: "NSAID", indications: ["Pain", "Inflammation"], preferredCategory: CAT.PAIN },
  { canonical: "naproxen", display: "Naproxen", synonyms: ["naproxen"], drugClass: "NSAID", indications: ["Pain", "Inflammation"], preferredCategory: CAT.PAIN },
  { canonical: "piroxicam", display: "Piroxicam", synonyms: ["piroxicam"], drugClass: "NSAID", indications: ["Pain", "Inflammation"], preferredCategory: CAT.PAIN },
  { canonical: "indomethacin", display: "Indomethacin", synonyms: ["indomethacin", "indometacin"], drugClass: "NSAID", indications: ["Pain", "Inflammation"], preferredCategory: CAT.PAIN },
  { canonical: "loxoprofen", display: "Loxoprofen", synonyms: ["loxoprofen"], drugClass: "NSAID", indications: ["Pain", "Inflammation"], preferredCategory: CAT.PAIN },
  { canonical: "mefenamic acid", display: "Mefenamic Acid", synonyms: ["mefenamic acid"], drugClass: "NSAID", indications: ["Pain", "Inflammation"], preferredCategory: CAT.PAIN },
  { canonical: "etodolac", display: "Etodolac", synonyms: ["etodolac"], drugClass: "NSAID", indications: ["Pain", "Inflammation"], preferredCategory: CAT.PAIN },
  { canonical: "celecoxib", display: "Celecoxib", synonyms: ["celecoxib"], drugClass: "NSAID (COX-2 inhibitor)", indications: ["Pain", "Inflammation"], preferredCategory: CAT.PAIN },
  { canonical: "meloxicam", display: "Meloxicam", synonyms: ["meloxicam"], drugClass: "NSAID", indications: ["Pain", "Inflammation"], preferredCategory: CAT.PAIN },
  { canonical: "tenoxicam", display: "Tenoxicam", synonyms: ["tenoxicam"], drugClass: "NSAID", indications: ["Pain", "Inflammation"], preferredCategory: CAT.PAIN },
  { canonical: "etoricoxib", display: "Etoricoxib", synonyms: ["etoricoxib"], drugClass: "NSAID (COX-2 inhibitor)", indications: ["Pain", "Inflammation"], preferredCategory: CAT.PAIN },
  // Muscle relaxants
  { canonical: "orphenadrine", display: "Orphenadrine", synonyms: ["orphenadrine", "orphenadrine citrate"], drugClass: "Muscle relaxant", indications: ["Muscle pain/spasm"], preferredCategory: CAT.MUSCLE },
  { canonical: "tizanidine", display: "Tizanidine", synonyms: ["tizanidine"], drugClass: "Muscle relaxant", indications: ["Muscle pain/spasm"], preferredCategory: CAT.MUSCLE },
  { canonical: "tolperisone", display: "Tolperisone", synonyms: ["tolperisone"], drugClass: "Muscle relaxant", indications: ["Muscle pain/spasm"], preferredCategory: CAT.MUSCLE },
  { canonical: "eperisone", display: "Eperisone", synonyms: ["eperisone"], drugClass: "Muscle relaxant", indications: ["Muscle pain/spasm"], preferredCategory: CAT.MUSCLE },
  // Corticosteroids — deferred (no clean steroid shelf)
  { canonical: "clotrimazole", display: "Clotrimazole", synonyms: ["clotrimazole"], drugClass: "Antifungal", indications: ["Fungal infection"], preferredCategory: CAT.ANTIFUNGAL },
  { canonical: "triamcinolone", display: "Triamcinolone", synonyms: ["triamcinolone", "triamcinolone acetonide"], drugClass: "Corticosteroid", indications: ["Inflammation", "Allergy"], preferredCategory: null, uncertainReason: "Topical/oral/injectable steroid — no clean steroid shelf category." },
  { canonical: "betamethasone", display: "Betamethasone", synonyms: ["betamethasone", "betamethasone valerate", "betamethasone dipropionate"], drugClass: "Corticosteroid", indications: ["Inflammation", "Allergy"], preferredCategory: null, uncertainReason: "Topical vs systemic steroid — ambiguous shelf." },
  // Endocrine / lipid
  { canonical: "metformin", display: "Metformin", synonyms: ["metformin", "metformin hydrochloride", "metformin hcl"], drugClass: "Antidiabetic (Biguanide)", indications: ["Diabetes"], preferredCategory: CAT.DIABETES },
  { canonical: "simvastatin", display: "Simvastatin", synonyms: ["simvastatin"], drugClass: "Statin (Lipid-lowering)", indications: ["Dyslipidemia"], preferredCategory: CAT.LIPID },
  { canonical: "rosuvastatin", display: "Rosuvastatin", synonyms: ["rosuvastatin"], drugClass: "Statin (Lipid-lowering)", indications: ["Dyslipidemia"], preferredCategory: CAT.LIPID },
  { canonical: "pravastatin", display: "Pravastatin", synonyms: ["pravastatin"], drugClass: "Statin (Lipid-lowering)", indications: ["Dyslipidemia"], preferredCategory: CAT.LIPID },
  { canonical: "pitavastatin", display: "Pitavastatin", synonyms: ["pitavastatin"], drugClass: "Statin (Lipid-lowering)", indications: ["Dyslipidemia"], preferredCategory: CAT.LIPID },
  { canonical: "gemfibrozil", display: "Gemfibrozil", synonyms: ["gemfibrozil"], drugClass: "Fibrate (Lipid-lowering)", indications: ["Dyslipidemia"], preferredCategory: CAT.LIPID },
  { canonical: "fenofibrate", display: "Fenofibrate", synonyms: ["fenofibrate"], drugClass: "Fibrate (Lipid-lowering)", indications: ["Dyslipidemia"], preferredCategory: CAT.LIPID },
  { canonical: "ezetimibe", display: "Ezetimibe", synonyms: ["ezetimibe"], drugClass: "Cholesterol absorption inhibitor", indications: ["Dyslipidemia"], preferredCategory: CAT.LIPID },
  // Antifungals
  { canonical: "ketoconazole", display: "Ketoconazole", synonyms: ["ketoconazole"], drugClass: "Antifungal", indications: ["Fungal infection"], preferredCategory: CAT.ANTIFUNGAL },
  { canonical: "itraconazole", display: "Itraconazole", synonyms: ["itraconazole"], drugClass: "Antifungal", indications: ["Fungal infection"], preferredCategory: CAT.ANTIFUNGAL },
  { canonical: "fluconazole", display: "Fluconazole", synonyms: ["fluconazole"], drugClass: "Antifungal", indications: ["Fungal infection"], preferredCategory: CAT.ANTIFUNGAL },
  { canonical: "griseofulvin", display: "Griseofulvin", synonyms: ["griseofulvin"], drugClass: "Antifungal", indications: ["Fungal infection"], preferredCategory: CAT.ANTIFUNGAL },
  { canonical: "miconazole", display: "Miconazole", synonyms: ["miconazole"], drugClass: "Antifungal", indications: ["Fungal infection"], preferredCategory: CAT.ANTIFUNGAL },
  { canonical: "sertaconazole", display: "Sertaconazole", synonyms: ["sertaconazole"], drugClass: "Antifungal", indications: ["Fungal infection"], preferredCategory: CAT.ANTIFUNGAL },
  { canonical: "nystatin", display: "Nystatin", synonyms: ["nystatin"], drugClass: "Antifungal", indications: ["Fungal infection"], preferredCategory: CAT.ANTIFUNGAL },
  // Antiseptics — deferred (broad/ambiguous)
  { canonical: "dequalinium chloride", display: "Dequalinium Chloride", synonyms: ["dequalinium chloride", "dequalinium"], drugClass: "Antiseptic", indications: ["Infection"], preferredCategory: null, uncertainReason: "Throat-lozenge antiseptic — ambiguous between lozenge/throat-spray shelves." },
  { canonical: "di-iodohydroxyquinoline", display: "Di-Iodohydroxyquinoline", synonyms: ["di-iodohydroxyquinoline", "diiodohydroxyquinoline", "iodoquinol"], drugClass: "Antiprotozoal/Antiseptic", indications: ["Infection"], preferredCategory: null, uncertainReason: "Antiprotozoal/topical antiseptic — no clear shelf." },
  { canonical: "benzalkonium chloride", display: "Benzalkonium Chloride", synonyms: ["benzalkonium chloride", "benzalkonium"], drugClass: "Antiseptic", indications: ["Infection"], preferredCategory: null, uncertainReason: "Very broad antiseptic used across many product types." },
  // Mucolytics / expectorants / respiratory misc
  { canonical: "acetylcysteine", display: "Acetylcysteine", synonyms: ["acetylcysteine", "n-acetylcysteine"], drugClass: "Mucolytic", indications: ["Mucus/Phlegm"], preferredCategory: CAT.MUCOLYTIC },
  { canonical: "bromhexine", display: "Bromhexine", synonyms: ["bromhexine", "bromhexine hydrochloride", "bromhexine hcl"], drugClass: "Mucolytic", indications: ["Mucus/Phlegm"], preferredCategory: CAT.MUCOLYTIC },
  { canonical: "ambroxol", display: "Ambroxol", synonyms: ["ambroxol"], drugClass: "Mucolytic", indications: ["Mucus/Phlegm"], preferredCategory: CAT.MUCOLYTIC },
  { canonical: "guaifenesin", display: "Guaifenesin", synonyms: ["guaifenesin", "glyceryl guaiacolate"], drugClass: "Expectorant", indications: ["Mucus/Phlegm"], preferredCategory: CAT.MUCOLYTIC },
  { canonical: "carbocisteine", display: "Carbocisteine", synonyms: ["carbocisteine", "carbocysteine", "carbocysteine lysine"], drugClass: "Mucolytic", indications: ["Mucus/Phlegm"], preferredCategory: CAT.MUCOLYTIC },
  // Antihistamines
  { canonical: "chlorpheniramine", display: "Chlorpheniramine", synonyms: ["chlorpheniramine", "chlorpheniramine maleate"], drugClass: "Antihistamine", indications: ["Allergy"], preferredCategory: CAT.ANTIHISTAMINE },
  { canonical: "brompheniramine", display: "Brompheniramine", synonyms: ["brompheniramine", "brompheniramine maleate"], drugClass: "Antihistamine", indications: ["Allergy"], preferredCategory: CAT.ANTIHISTAMINE },
  { canonical: "diphenhydramine", display: "Diphenhydramine", synonyms: ["diphenhydramine"], drugClass: "Antihistamine", indications: ["Allergy"], preferredCategory: CAT.ANTIHISTAMINE },
  { canonical: "triprolidine", display: "Triprolidine", synonyms: ["triprolidine", "triprolidine hydrochloride"], drugClass: "Antihistamine", indications: ["Allergy"], preferredCategory: CAT.ANTIHISTAMINE },
  { canonical: "doxylamine", display: "Doxylamine", synonyms: ["doxylamine", "doxylamine succinate"], drugClass: "Antihistamine", indications: ["Allergy"], preferredCategory: CAT.ANTIHISTAMINE },
  { canonical: "hydroxyzine", display: "Hydroxyzine", synonyms: ["hydroxyzine"], drugClass: "Antihistamine", indications: ["Allergy"], preferredCategory: CAT.ANTIHISTAMINE },
  { canonical: "cyproheptadine", display: "Cyproheptadine", synonyms: ["cyproheptadine"], drugClass: "Antihistamine", indications: ["Allergy"], preferredCategory: CAT.ANTIHISTAMINE },
  { canonical: "ketotifen", display: "Ketotifen", synonyms: ["ketotifen"], drugClass: "Antihistamine", indications: ["Allergy"], preferredCategory: CAT.ANTIHISTAMINE },
  { canonical: "fexofenadine", display: "Fexofenadine", synonyms: ["fexofenadine"], drugClass: "Antihistamine", indications: ["Allergy"], preferredCategory: CAT.ANTIHISTAMINE },
  { canonical: "bilastine", display: "Bilastine", synonyms: ["bilastine"], drugClass: "Antihistamine", indications: ["Allergy"], preferredCategory: CAT.ANTIHISTAMINE },
  { canonical: "levocetirizine", display: "Levocetirizine", synonyms: ["levocetirizine"], drugClass: "Antihistamine", indications: ["Allergy"], preferredCategory: CAT.ANTIHISTAMINE },
  { canonical: "desloratadine", display: "Desloratadine", synonyms: ["desloratadine"], drugClass: "Antihistamine", indications: ["Allergy"], preferredCategory: CAT.ANTIHISTAMINE },
  { canonical: "dimenhydrinate", display: "Dimenhydrinate", synonyms: ["dimenhydrinate"], drugClass: "Antihistamine (Antiemetic)", indications: ["Motion sickness/Vertigo"], preferredCategory: CAT.VERTIGO },
  { canonical: "phenylephrine", display: "Phenylephrine", synonyms: ["phenylephrine"], drugClass: "Decongestant", indications: ["Cold/Congestion"], preferredCategory: null, uncertainReason: "Oral decongestant vs nasal/eye/vasopressor — ambiguous shelf." },
  // GI
  { canonical: "simethicone", display: "Simethicone", synonyms: ["simethicone", "simeticone"], drugClass: "Antiflatulent", indications: ["Bloating/Flatulence"], preferredCategory: CAT.ANTIFLATULENT },
  { canonical: "alverine", display: "Alverine", synonyms: ["alverine", "alverine citrate"], drugClass: "Antispasmodic", indications: ["Abdominal cramps"], preferredCategory: CAT.ANTISPASMODIC },
  { canonical: "hyoscine", display: "Hyoscine Butylbromide", synonyms: ["hyoscine", "hyoscine butylbromide", "scopolamine butylbromide", "butylscopolamine"], drugClass: "Antispasmodic", indications: ["Abdominal cramps"], preferredCategory: CAT.ANTISPASMODIC },
  { canonical: "dicyclomine", display: "Dicyclomine", synonyms: ["dicyclomine", "dicycloverine"], drugClass: "Antispasmodic", indications: ["Abdominal cramps"], preferredCategory: CAT.ANTISPASMODIC },
  { canonical: "drotaverine", display: "Drotaverine", synonyms: ["drotaverine"], drugClass: "Antispasmodic", indications: ["Abdominal cramps"], preferredCategory: CAT.ANTISPASMODIC },
  { canonical: "domperidone", display: "Domperidone", synonyms: ["domperidone"], drugClass: "Prokinetic/Antiemetic", indications: ["Nausea/Vomiting"], preferredCategory: CAT.ANTIEMETIC },
  { canonical: "metoclopramide", display: "Metoclopramide", synonyms: ["metoclopramide"], drugClass: "Prokinetic/Antiemetic", indications: ["Nausea/Vomiting"], preferredCategory: CAT.ANTIEMETIC },
  { canonical: "itopride", display: "Itopride", synonyms: ["itopride"], drugClass: "Prokinetic", indications: ["Gastrointestinal motility"], preferredCategory: CAT.PROKINETIC },
  { canonical: "mosapride", display: "Mosapride", synonyms: ["mosapride"], drugClass: "Prokinetic", indications: ["Gastrointestinal motility"], preferredCategory: CAT.PROKINETIC },
  { canonical: "cisapride", display: "Cisapride", synonyms: ["cisapride"], drugClass: "Prokinetic", indications: ["Gastrointestinal motility"], preferredCategory: CAT.PROKINETIC },
  { canonical: "rebamipide", display: "Rebamipide", synonyms: ["rebamipide"], drugClass: "Gastroprotective", indications: ["Gastric ulcer"], preferredCategory: CAT.GASTROPROTECT },
  // Acid suppression
  { canonical: "omeprazole", display: "Omeprazole", synonyms: ["omeprazole"], drugClass: "Proton pump inhibitor", indications: ["Acid reflux/Gastric acid"], preferredCategory: CAT.ANTACID },
  { canonical: "esomeprazole", display: "Esomeprazole", synonyms: ["esomeprazole"], drugClass: "Proton pump inhibitor", indications: ["Acid reflux/Gastric acid"], preferredCategory: CAT.ANTACID },
  { canonical: "rabeprazole", display: "Rabeprazole", synonyms: ["rabeprazole"], drugClass: "Proton pump inhibitor", indications: ["Acid reflux/Gastric acid"], preferredCategory: CAT.ANTACID },
  { canonical: "lansoprazole", display: "Lansoprazole", synonyms: ["lansoprazole"], drugClass: "Proton pump inhibitor", indications: ["Acid reflux/Gastric acid"], preferredCategory: CAT.ANTACID },
  { canonical: "dexlansoprazole", display: "Dexlansoprazole", synonyms: ["dexlansoprazole"], drugClass: "Proton pump inhibitor", indications: ["Acid reflux/Gastric acid"], preferredCategory: CAT.ANTACID },
  { canonical: "pantoprazole", display: "Pantoprazole", synonyms: ["pantoprazole"], drugClass: "Proton pump inhibitor", indications: ["Acid reflux/Gastric acid"], preferredCategory: CAT.ANTACID },
  { canonical: "vonoprazan", display: "Vonoprazan", synonyms: ["vonoprazan"], drugClass: "Potassium-competitive acid blocker", indications: ["Acid reflux/Gastric acid"], preferredCategory: CAT.ANTACID },
  { canonical: "cimetidine", display: "Cimetidine", synonyms: ["cimetidine"], drugClass: "H2 antagonist", indications: ["Acid reflux/Gastric acid"], preferredCategory: CAT.ANTACID },
  { canonical: "famotidine", display: "Famotidine", synonyms: ["famotidine"], drugClass: "H2 antagonist", indications: ["Acid reflux/Gastric acid"], preferredCategory: CAT.ANTACID },
  // Cardiovascular — antihypertensives
  { canonical: "amlodipine", display: "Amlodipine", synonyms: ["amlodipine", "amlodipine besylate", "amlodipine besilate", "amlodipine maleate"], drugClass: "Calcium channel blocker", indications: ["Hypertension"], preferredCategory: CAT.HYPERTENSION },
  { canonical: "manidipine", display: "Manidipine", synonyms: ["manidipine"], drugClass: "Calcium channel blocker", indications: ["Hypertension"], preferredCategory: CAT.HYPERTENSION },
  { canonical: "nifedipine", display: "Nifedipine", synonyms: ["nifedipine"], drugClass: "Calcium channel blocker", indications: ["Hypertension"], preferredCategory: CAT.HYPERTENSION },
  { canonical: "lercanidipine", display: "Lercanidipine", synonyms: ["lercanidipine"], drugClass: "Calcium channel blocker", indications: ["Hypertension"], preferredCategory: CAT.HYPERTENSION },
  { canonical: "verapamil", display: "Verapamil", synonyms: ["verapamil"], drugClass: "Calcium channel blocker", indications: ["Hypertension"], preferredCategory: CAT.HYPERTENSION },
  { canonical: "diltiazem", display: "Diltiazem", synonyms: ["diltiazem"], drugClass: "Calcium channel blocker", indications: ["Hypertension"], preferredCategory: CAT.HYPERTENSION },
  { canonical: "enalapril", display: "Enalapril", synonyms: ["enalapril"], drugClass: "ACE inhibitor", indications: ["Hypertension"], preferredCategory: CAT.HYPERTENSION },
  { canonical: "losartan", display: "Losartan", synonyms: ["losartan"], drugClass: "ARB", indications: ["Hypertension"], preferredCategory: CAT.HYPERTENSION },
  { canonical: "candesartan", display: "Candesartan", synonyms: ["candesartan"], drugClass: "ARB", indications: ["Hypertension"], preferredCategory: CAT.HYPERTENSION },
  { canonical: "valsartan", display: "Valsartan", synonyms: ["valsartan"], drugClass: "ARB", indications: ["Hypertension"], preferredCategory: CAT.HYPERTENSION },
  { canonical: "irbesartan", display: "Irbesartan", synonyms: ["irbesartan"], drugClass: "ARB", indications: ["Hypertension"], preferredCategory: CAT.HYPERTENSION },
  { canonical: "azilsartan", display: "Azilsartan", synonyms: ["azilsartan"], drugClass: "ARB", indications: ["Hypertension"], preferredCategory: CAT.HYPERTENSION },
  { canonical: "hydralazine", display: "Hydralazine", synonyms: ["hydralazine"], drugClass: "Vasodilator (Antihypertensive)", indications: ["Hypertension"], preferredCategory: CAT.HYPERTENSION },
  { canonical: "atenolol", display: "Atenolol", synonyms: ["atenolol"], drugClass: "Beta blocker", indications: ["Hypertension"], preferredCategory: CAT.HYPERTENSION },
  { canonical: "metoprolol", display: "Metoprolol", synonyms: ["metoprolol"], drugClass: "Beta blocker", indications: ["Hypertension"], preferredCategory: CAT.HYPERTENSION },
  { canonical: "propranolol", display: "Propranolol", synonyms: ["propranolol"], drugClass: "Beta blocker", indications: ["Hypertension"], preferredCategory: CAT.HYPERTENSION },
  { canonical: "bisoprolol", display: "Bisoprolol", synonyms: ["bisoprolol", "bisoprolol fumarate"], drugClass: "Beta blocker", indications: ["Hypertension"], preferredCategory: CAT.HYPERTENSION },
  { canonical: "carvedilol", display: "Carvedilol", synonyms: ["carvedilol"], drugClass: "Beta blocker", indications: ["Hypertension"], preferredCategory: CAT.HYPERTENSION },
  // Cardiovascular — diuretics
  { canonical: "furosemide", display: "Furosemide", synonyms: ["furosemide", "frusemide"], drugClass: "Diuretic (Loop)", indications: ["Edema/Hypertension"], preferredCategory: CAT.DIURETIC },
  { canonical: "spironolactone", display: "Spironolactone", synonyms: ["spironolactone"], drugClass: "Diuretic (Potassium-sparing)", indications: ["Edema/Hypertension"], preferredCategory: CAT.DIURETIC },
  { canonical: "hydrochlorothiazide", display: "Hydrochlorothiazide", synonyms: ["hydrochlorothiazide", "hctz"], drugClass: "Diuretic (Thiazide)", indications: ["Hypertension"], preferredCategory: CAT.DIURETIC },
  { canonical: "amiloride", display: "Amiloride", synonyms: ["amiloride"], drugClass: "Diuretic (Potassium-sparing)", indications: ["Edema/Hypertension"], preferredCategory: CAT.DIURETIC },
  { canonical: "indapamide", display: "Indapamide", synonyms: ["indapamide"], drugClass: "Diuretic (Thiazide-like)", indications: ["Hypertension"], preferredCategory: CAT.DIURETIC },
  { canonical: "acetazolamide", display: "Acetazolamide", synonyms: ["acetazolamide"], drugClass: "Carbonic anhydrase inhibitor", indications: ["Glaucoma/Diuresis"], preferredCategory: null, uncertainReason: "Mainly glaucoma/altitude rather than a diuretic shelf — ambiguous." },
  // Cardiovascular — antiplatelet / anticoagulant / heart
  { canonical: "clopidogrel", display: "Clopidogrel", synonyms: ["clopidogrel"], drugClass: "Antiplatelet", indications: ["Cardiovascular"], preferredCategory: CAT.ANTIPLATELET },
  { canonical: "aspirin", display: "Aspirin", synonyms: ["aspirin", "acetylsalicylic acid"], drugClass: "Antiplatelet/NSAID", indications: ["Cardiovascular", "Pain"], preferredCategory: null, uncertainReason: "Dual-use: low-dose antiplatelet vs analgesic — ambiguous shelf." },
  { canonical: "rivaroxaban", display: "Rivaroxaban", synonyms: ["rivaroxaban"], drugClass: "Anticoagulant", indications: ["Cardiovascular"], preferredCategory: null, uncertainReason: "No clean anticoagulant shelf (existing thrombolytic category is not equivalent)." },
  { canonical: "apixaban", display: "Apixaban", synonyms: ["apixaban"], drugClass: "Anticoagulant", indications: ["Cardiovascular"], preferredCategory: null, uncertainReason: "No clean anticoagulant shelf (existing thrombolytic category is not equivalent)." },
  { canonical: "isosorbide mononitrate", display: "Isosorbide Mononitrate", synonyms: ["isosorbide mononitrate"], drugClass: "Nitrate", indications: ["Cardiovascular"], preferredCategory: CAT.HEART },
  { canonical: "isosorbide dinitrate", display: "Isosorbide Dinitrate", synonyms: ["isosorbide dinitrate"], drugClass: "Nitrate", indications: ["Cardiovascular"], preferredCategory: CAT.HEART },
  { canonical: "trimetazidine", display: "Trimetazidine", synonyms: ["trimetazidine"], drugClass: "Anti-anginal", indications: ["Cardiovascular"], preferredCategory: CAT.HEART },
  { canonical: "digoxin", display: "Digoxin", synonyms: ["digoxin"], drugClass: "Cardiac glycoside", indications: ["Cardiovascular"], preferredCategory: CAT.HEART },
  // Neuro
  { canonical: "gabapentin", display: "Gabapentin", synonyms: ["gabapentin"], drugClass: "Neuropathic pain agent", indications: ["Neuropathic pain"], preferredCategory: CAT.NEUROPATHIC },
  { canonical: "dextromethorphan", display: "Dextromethorphan", synonyms: ["dextromethorphan", "dextromethorphan hydrobromide", "dextromethorphan hbr"], drugClass: "Antitussive", indications: ["Cough"], preferredCategory: CAT.COUGH },
  { canonical: "levodropropizine", display: "Levodropropizine", synonyms: ["levodropropizine"], drugClass: "Antitussive", indications: ["Cough"], preferredCategory: CAT.COUGH },
  // Respiratory — bronchodilators
  { canonical: "salbutamol", display: "Salbutamol", synonyms: ["salbutamol", "albuterol"], drugClass: "Beta-2 agonist (Bronchodilator)", indications: ["Respiratory/Asthma"], preferredCategory: CAT.BRONCHODILATOR },
  { canonical: "terbutaline", display: "Terbutaline", synonyms: ["terbutaline"], drugClass: "Beta-2 agonist (Bronchodilator)", indications: ["Respiratory/Asthma"], preferredCategory: CAT.BRONCHODILATOR },
  { canonical: "procaterol", display: "Procaterol", synonyms: ["procaterol"], drugClass: "Beta-2 agonist (Bronchodilator)", indications: ["Respiratory/Asthma"], preferredCategory: CAT.BRONCHODILATOR },
  { canonical: "theophylline", display: "Theophylline", synonyms: ["theophylline"], drugClass: "Bronchodilator (Xanthine)", indications: ["Respiratory/Asthma"], preferredCategory: CAT.BRONCHODILATOR },
  { canonical: "montelukast", display: "Montelukast", synonyms: ["montelukast"], drugClass: "Leukotriene receptor antagonist", indications: ["Respiratory/Asthma", "Allergy"], preferredCategory: null, uncertainReason: "Asthma/allergic-rhinitis controller, not a bronchodilator — shelf ambiguous." },
];

// ── env / db (shared pattern with other scripts) ─────────────────────────────
function parseEnvFile(contents) {
  const env = {};
  for (const rawLine of String(contents || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadEnvFallback(rootDir) {
  if (process.env.DATABASE_URL) return;
  const envPath = path.join(rootDir, "apps", "admin-api", ".env");
  if (!fs.existsSync(envPath)) return;
  const env = parseEnvFile(fs.readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(env)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

function dbConfigFromUrl(dbUrl) {
  const sslMode = String(process.env.PGSSLMODE || "").toLowerCase();
  if (dbUrl.includes("sslmode=require") || sslMode === "require" || dbUrl.includes("render.com")) {
    return { connectionString: dbUrl, ssl: { rejectUnauthorized: false } };
  }
  return { connectionString: dbUrl };
}

function parseCliArgs(argv) {
  const args = { dryRun: true, commit: false, dbUrl: process.env.DATABASE_URL || "" };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === "--dry-run") { args.dryRun = true; args.commit = false; }
    else if (t === "--commit") { args.commit = true; args.dryRun = false; }
    else if (t === "--db-url") args.dbUrl = argv[++i] || "";
    else if (t === "--help" || t === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${t}`);
  }
  return args;
}

// ── upsert helpers (RETURNING (xmax = 0) AS inserted to detect fresh inserts) ──
async function loadCategorySet(client) {
  const result = await client.query(`
    SELECT DISTINCT category_name
    FROM ada.product_category_states
    WHERE review_status IN ('confirmed', 'imported_exact_match')
      AND category_name IS NOT NULL
      AND BTRIM(category_name) <> ''
  `);
  return new Set(result.rows.map((r) => r.category_name));
}

async function upsertIngredient(client, { canonical, display }) {
  const r = await client.query(
    `
      INSERT INTO knowledge.ingredients (canonical_name, display_name, status, updated_at)
      VALUES ($1, $2, 'active', now())
      ON CONFLICT (canonical_name) DO UPDATE SET
        display_name = EXCLUDED.display_name, status = 'active', updated_at = now()
      RETURNING ingredient_id, (xmax = 0) AS inserted
    `,
    [canonical, display],
  );
  return { id: Number(r.rows[0].ingredient_id), inserted: r.rows[0].inserted };
}

async function insertSynonymIfMissing(client, { ingredientId, synonymText }) {
  const r = await client.query(
    `
      INSERT INTO knowledge.ingredient_synonyms
        (ingredient_id, synonym_text, language, source, status, updated_at)
      SELECT $1, $2, 'en', $3, 'active', now()
      WHERE NOT EXISTS (
        SELECT 1 FROM knowledge.ingredient_synonyms
        WHERE LOWER(BTRIM(synonym_text)) = LOWER(BTRIM($2))
      )
      RETURNING synonym_id
    `,
    [ingredientId, synonymText, SOURCE],
  );
  return r.rowCount > 0;
}

async function upsertDrugClass(client, name) {
  const r = await client.query(
    `
      INSERT INTO knowledge.drug_classes (name, status, updated_at)
      VALUES ($1, 'active', now())
      ON CONFLICT (name) DO UPDATE SET status = 'active', updated_at = now()
      RETURNING drug_class_id, (xmax = 0) AS inserted
    `,
    [name],
  );
  return { id: Number(r.rows[0].drug_class_id), inserted: r.rows[0].inserted };
}

async function upsertIndication(client, name) {
  const r = await client.query(
    `
      INSERT INTO knowledge.indications (name, status, updated_at)
      VALUES ($1, 'active', now())
      ON CONFLICT (name) DO UPDATE SET status = 'active', updated_at = now()
      RETURNING indication_id, (xmax = 0) AS inserted
    `,
    [name],
  );
  return { id: Number(r.rows[0].indication_id), inserted: r.rows[0].inserted };
}

async function upsertIngredientDrugClass(client, { ingredientId, drugClassId }) {
  const r = await client.query(
    `
      INSERT INTO knowledge.ingredient_drug_classes
        (ingredient_id, drug_class_id, confidence, source, status, confirmed_by, confirmed_at, updated_at)
      VALUES ($1, $2, 1, $3, 'confirmed', $3, now(), now())
      ON CONFLICT (ingredient_id, drug_class_id) DO UPDATE SET
        source = EXCLUDED.source, status = 'confirmed', updated_at = now()
      RETURNING (xmax = 0) AS inserted
    `,
    [ingredientId, drugClassId, SOURCE],
  );
  return r.rows[0].inserted;
}

async function upsertIngredientIndication(client, { ingredientId, indicationId }) {
  const r = await client.query(
    `
      INSERT INTO knowledge.ingredient_indications
        (ingredient_id, indication_id, source, status, confirmed_by, confirmed_at, updated_at)
      VALUES ($1, $2, $3, 'confirmed', $3, now(), now())
      ON CONFLICT (ingredient_id, indication_id) DO UPDATE SET
        source = EXCLUDED.source, status = 'confirmed', updated_at = now()
      RETURNING (xmax = 0) AS inserted
    `,
    [ingredientId, indicationId, SOURCE],
  );
  return r.rows[0].inserted;
}

async function insertCategoryRuleIfMissing(client, { ingredientId, categoryName, priority, note }) {
  const r = await client.query(
    `
      INSERT INTO knowledge.ingredient_category_rules
        (ingredient_id, drug_class_id, indication_id, category_name, priority, rule_status, note, created_by, updated_at)
      SELECT $1, NULL, NULL, $2, $3, 'active', $4, $5, now()
      WHERE NOT EXISTS (
        SELECT 1 FROM knowledge.ingredient_category_rules
        WHERE ingredient_id = $1 AND drug_class_id IS NULL AND indication_id IS NULL
          AND category_name = $2 AND created_by = $5
      )
      RETURNING rule_id
    `,
    [ingredientId, categoryName, priority, note, SOURCE],
  );
  return r.rowCount > 0;
}

// ── main seed routine ────────────────────────────────────────────────────────
async function seed(client, { commit }) {
  const stats = {
    mode: commit ? "commit" : "dry-run",
    totalInputTerms: RAW_TERMS.length,
    normalizedUniqueIngredients: INGREDIENTS.length,
    corrections: CORRECTIONS,
    modelingNotes: MODELING_NOTES,
    ingredients: { inserted: 0, skipped: 0 },
    synonyms: { inserted: 0, skipped: 0 },
    drugClassMappings: { inserted: 0, skipped: 0 },
    indicationMappings: { inserted: 0, skipped: 0 },
    categoryRules: { inserted: 0, skipped: 0 },
    uncertainCategoryMappings: [],
  };

  // Guard against accidental duplicate canonical entries in this batch's array.
  const seen = new Set();
  for (const def of INGREDIENTS) {
    if (seen.has(def.canonical)) throw new Error(`Duplicate canonical in batch array: ${def.canonical}`);
    seen.add(def.canonical);
  }

  await client.query("BEGIN");
  try {
    const categorySet = await loadCategorySet(client);

    for (const def of INGREDIENTS) {
      const ing = await upsertIngredient(client, def);
      if (ing.inserted) stats.ingredients.inserted += 1; else stats.ingredients.skipped += 1;

      for (const synonymText of def.synonyms) {
        const inserted = await insertSynonymIfMissing(client, { ingredientId: ing.id, synonymText });
        if (inserted) stats.synonyms.inserted += 1; else stats.synonyms.skipped += 1;
      }

      const dc = await upsertDrugClass(client, def.drugClass);
      const dcMap = await upsertIngredientDrugClass(client, { ingredientId: ing.id, drugClassId: dc.id });
      if (dcMap) stats.drugClassMappings.inserted += 1; else stats.drugClassMappings.skipped += 1;

      for (const indicationName of def.indications) {
        const ind = await upsertIndication(client, indicationName);
        const indMap = await upsertIngredientIndication(client, { ingredientId: ing.id, indicationId: ind.id });
        if (indMap) stats.indicationMappings.inserted += 1; else stats.indicationMappings.skipped += 1;
      }

      const resolvedCategory =
        def.preferredCategory && categorySet.has(def.preferredCategory) ? def.preferredCategory : null;

      if (resolvedCategory) {
        const ruleInserted = await insertCategoryRuleIfMissing(client, {
          ingredientId: ing.id,
          categoryName: resolvedCategory,
          priority: 20,
          note: `Batch 2 ingredient rule: ${def.display} -> ${def.drugClass} -> ${resolvedCategory}`,
        });
        if (ruleInserted) stats.categoryRules.inserted += 1; else stats.categoryRules.skipped += 1;
      } else {
        stats.uncertainCategoryMappings.push({
          ingredient: def.display,
          drugClass: def.drugClass,
          preferredCategory: def.preferredCategory,
          reason: def.uncertainReason
            || (def.preferredCategory
              ? `Preferred category "${def.preferredCategory}" not found among confirmed/imported categories`
              : "No clearly suitable existing category (deliberately deferred)"),
        });
      }
    }

    if (commit) {
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK");
    }
    return stats;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function printSummary(stats) {
  const lines = [];
  lines.push("==================================================");
  lines.push(` INGREDIENT DICTIONARY SEED — BATCH 2  [${stats.mode.toUpperCase()}]`);
  lines.push("==================================================");
  lines.push(`Total input terms (FADAsoft SET 2) : ${stats.totalInputTerms}`);
  lines.push(`Normalized unique ingredients      : ${stats.normalizedUniqueIngredients}`);
  lines.push("");
  lines.push(`Ingredients      : inserted ${stats.ingredients.inserted}, skipped ${stats.ingredients.skipped}`);
  lines.push(`Synonyms         : inserted ${stats.synonyms.inserted}, skipped ${stats.synonyms.skipped}`);
  lines.push(`Drug-class maps  : inserted ${stats.drugClassMappings.inserted}, skipped ${stats.drugClassMappings.skipped}`);
  lines.push(`Indication maps  : inserted ${stats.indicationMappings.inserted}, skipped ${stats.indicationMappings.skipped}`);
  lines.push(`Category rules   : inserted ${stats.categoryRules.inserted}, skipped ${stats.categoryRules.skipped}`);
  lines.push("");
  lines.push("Typo corrections applied:");
  for (const c of stats.corrections) lines.push(`  - "${c.from}" -> "${c.to}" (${c.note})`);
  lines.push("");
  lines.push("Modeling notes:");
  for (const n of stats.modelingNotes) lines.push(`  - ${n}`);
  lines.push("");
  lines.push(`Uncertain category mappings (no rule written): ${stats.uncertainCategoryMappings.length}`);
  for (const u of stats.uncertainCategoryMappings) {
    lines.push(`  - ${u.ingredient} (${u.drugClass}): ${u.reason}`);
  }
  if (stats.mode === "dry-run") {
    lines.push("");
    lines.push("DRY-RUN: no changes were committed. Re-run with --commit to persist.");
  }
  console.log(lines.join("\n"));
}

async function main() {
  const rootDir = path.resolve(__dirname, "..");
  loadEnvFallback(rootDir);
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log("node scripts/seed_ingredient_dictionary_batch2.js [--dry-run] [--commit] [--db-url <url>]");
    return;
  }
  if (!args.dbUrl) throw new Error("Missing database URL. Use --db-url or set DATABASE_URL");

  const client = new Client(dbConfigFromUrl(args.dbUrl));
  await client.connect();
  try {
    const stats = await seed(client, args);
    printSummary(stats);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Batch 2 seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseCliArgs, seed, INGREDIENTS, RAW_TERMS };
