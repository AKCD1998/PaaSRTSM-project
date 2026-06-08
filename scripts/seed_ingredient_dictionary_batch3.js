#!/usr/bin/env node
"use strict";

/**
 * Ingredient Dictionary Seed — Batch 3 (FADAsoft active ingredient list SET 3).
 *
 * Dictionary-only seed (same safe, idempotent pattern as batch 1 & 2):
 *   knowledge.ingredients / ingredient_synonyms / drug_classes /
 *   ingredient_drug_classes / indications / ingredient_indications /
 *   ingredient_category_rules.
 *
 * Never touches product_ingredients, never invents categories, never auto-confirms.
 * Default --dry-run (transaction rolled back); --commit persists.
 *
 *   node scripts/seed_ingredient_dictionary_batch3.js [--dry-run|--commit] [--db-url <url>]
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const SOURCE = "seed_dictionary_batch_3";

const RAW_TERMS = [
  "Fluocinolone acetonide", "Diflucortolone valerate", "Desoximetasone", "Hydrocortisone",
  "Cinchocaine", "Lidocaine", "Adapalene", "Sucralfate", "Tretinoin", "Azelaic acid",
  "Chamomile", "Clioquinol", "Bacitracin", "Sulfanilamide", "Choline salicylate",
  "Mometasone furoate", "Clobetasol propionate", "Fusidic acid", "Gentamicin", "Neomycin",
  "Chloramphenicol", "Mupirocin", "Amikacin", "Silver sulfadiazine", "Acyclovir",
  "Terbinafine", "Tolnaftate", "Isoconazole", "Hydrocortisone acetate", "Benzoyl peroxide",
  "Bisacodyl", "Mebeverine", "Bismuth subsalicylate", "Flavoxate", "Trospium chloride",
  "Betahistine mesylate", "Betahistine dihydrochloride", "Nicergoline", "Cinnarizine",
  "Flunarizine", "Sumatriptan", "Eletriptan", "Piracetam", "Albendazole", "Mebendazole",
  "Tramadol", "Pioglitazone", "Budesonide", "Naphazoline", "Oxymetazoline", "Xylometazoline",
  "Finasteride", "Silymarin", "Minoxidil", "Allopurinol", "Doxazosin", "Prazosin", "Alfuzosine",
  "Dutasteride", "Tamsulosin", "Orlistat", "Sitagliptin", "Empagliflozin", "Dapagliflozin",
  "Glipizide", "Glimepiride", "Glicazide", "Vildagliptin", "Ursodeoxycholic acide",
  "Norethisterone", "Clomifene citrate", "Levonorgestrel", "Norgestrel", "Estradiol valerate",
  "Teprenone", "Dienogest", "Cyproterone acetate", "Progesterone", "Dydrogesterone",
  "Estradiol hemihydrate", "Desogestrel", "Gestodene", "Ethinyl Estradiol", "Norgestimate",
  "Drospirenone", "Cloxacillin", "Timolol", "Olapatadine", "Antazoline", "Prednicarbate",
  "Ammonium citrate", "Prucalopride", "Loteprednol", "Hypromellose", "Carboxymethylcellulose CMC",
  "Sodium hyaluronate", "Ferrous sulfate", "Ferrous fumarate", "Ferrous gluconate",
  "Chelated magnesium", "Chlorhexidine", "Escitalopram", "Sertraline", "Fluoxetine", "Duloxetine",
  "Buproprion", "Nortriptyline", "Amitriptyline", "Levetiracetam", "Circadin", "Sodium valproate",
  "Phenytoin", "Mecobalamin/methycobal/cyanocobalamin", "Flurbiprofen", "Amylmetacresol",
  "2,4-Dichlorobenzyl alcohol", "Benzydamine Hydrochloride", "Quetiapine", "Fluticasone propionate",
  "Salmeterol", "Formoterol", "Salbutamol", "Albuterol", "Levothyroxine", "PTU/Propylthiouracil",
  "MMI/Methimazole", "Pentoxifylline", "Ginkgo biloba", "Donepezil", "Memantine",
  "Calcium carbonate", "Aluminium hydroxide", "Magnesium hydroxide", "Lactulose", "vitamin c",
  "Guaifenesin (family)", "Guaiacol", "Potassium Guaiacolsulfonate", "Sodium Guaiacolsulfonate",
  "Guaiacol Carbonate", "Creosotal", "Activated charcoal", "Dioctahedral smectite", "Acemetacin",
  "tacrolimus", "Peppermint oil", "docusate sodium", "loperamide", "racecadotril",
  "pheniramine maleate", "disodium cromoglycate", "nicotine", "cytisine",
];

const CORRECTIONS = [
  { from: "Olapatadine", to: "olopatadine", note: "misspelling of olopatadine" },
  { from: "Alfuzosine", to: "alfuzosin", note: "misspelling of alfuzosin" },
  { from: "Glicazide", to: "gliclazide", note: "misspelling of gliclazide" },
  { from: "Buproprion", to: "bupropion", note: "misspelling of bupropion" },
  { from: "Ursodeoxycholic acide", to: "ursodeoxycholic acid", note: "trailing 'e' typo" },
];

const MODELING_NOTES = [
  "Topical/ophthalmic/inhaled corticosteroids seeded with class+indication but NO category rule (no clean steroid shelf) — consistent with batches 1-2.",
  "hydrocortisone acetate modeled as a synonym/salt of hydrocortisone.",
  "betahistine mesylate + dihydrochloride merged into one 'Betahistine' ingredient (salts as synonyms).",
  "albuterol modeled as a synonym of salbutamol (same drug); guaifenesin family extends existing guaifenesin synonyms.",
  "B12 family: 'Mecobalamin' with synonyms methylcobalamin/methycobal/cyanocobalamin/vitamin b12.",
  "PTU->Propylthiouracil, MMI->Methimazole modeled as canonical + abbreviation synonym.",
  "Vitamin C modeled as one ingredient with the full supplied ascorbate/derivative synonym list.",
  "circadin modeled as brand synonym of Melatonin (category deferred — no sleep-aid shelf).",
];

const CAT = {
  ANTIBIOTIC: "2ยาฆ่าเชื้อ",
  ANTIFUNGAL: "2ยาฆ่าเชื้อรา",
  ANTIVIRAL: "1ยาฆ่าเชื้อไวรัส",
  ANTIHELMINTH: "1ยาถ่ายพยาธิ",
  ANTIHISTAMINE: "2ยาแก้แพ้",
  LOZENGE: "2ยาอมแก้อักเสบ",
  PAIN: "3ยาแก้ปวด",
  VERTIGO: "3ยาแก้เวียน",
  MIGRAINE: "3ยาไมเกรน",
  CONTRACEPTIVE: "4ยาคุม",
  FEMALE_HORMONE: "4ยาฮอร์โมนหญิง",
  ANTACID: "4ยาลดกรด",
  ANTIDIARRHEAL: "4ยาหยุดถ่าย",
  ANTISPASMODIC: "4ยาปวดเกร็ง",
  STOMACH: "4ยากระเพาะ",
  PROKINETIC: "4เพิ่มการเคลี่ยนไหว",
  GASTROPROTECT: "เคลือบแผลในกระเพาะ",
  LAXATIVE: "ยาระบาย",
  DIARRHEA: "ยาแก้ท้องเสีย",
  CHARCOAL: "คาร์บอน",
  CARMINATIVE: "ขับลม",
  MUCOLYTIC: "ละลายเสมหะ",
  EYE_EAR: "6ยาตาและหู",
  EYE_DROP: "6ยาหยอดตา",
  BRONCHODILATOR: "6ยาขยายหลอดลม",
  NASAL: "พ่นจมูก",
  ARTIFICIAL_TEARS: "น้ำตาเทียม",
  PSYCH: "7ยาจิตเวช",
  ANTICONVULSANT: "7ยากันชัก",
  BRAIN: "8ยาสมอง",
  BLOOD: "7ยาเลือด",
  DIABETES: "8ยาเบาหวาน",
  THYROID: "8ยาไทรอย",
  SMOKING: "8เลิกบุหรี่",
  PROSTATE: "9ยาต่อมลูกหมาก",
  HAIR: "9ยาปลูกผม",
  LIVER: "9ยาบำรุงตับ",
  STONE: "9ยาละลายนิ่ว",
  URIC: "9ยาลดยูริค",
  VITAMIN: "วิตามิน",
  HERBAL: "สมุนไพร",
  CANKER: "ยาทาแก้ร้อนใน",
};

const STEROID_REASON = "Topical/ophthalmic/inhaled corticosteroid — no clean steroid shelf category.";

const INGREDIENTS = [
  // ── Corticosteroids (deferred) ──
  { canonical: "fluocinolone acetonide", display: "Fluocinolone Acetonide", synonyms: ["fluocinolone acetonide", "fluocinolone"], drugClass: "Corticosteroid", indications: ["Inflammation", "Allergy"], preferredCategory: null, uncertainReason: STEROID_REASON },
  { canonical: "diflucortolone valerate", display: "Diflucortolone Valerate", synonyms: ["diflucortolone valerate", "diflucortolone"], drugClass: "Corticosteroid", indications: ["Inflammation"], preferredCategory: null, uncertainReason: STEROID_REASON },
  { canonical: "desoximetasone", display: "Desoximetasone", synonyms: ["desoximetasone", "desoxymethasone"], drugClass: "Corticosteroid", indications: ["Inflammation"], preferredCategory: null, uncertainReason: STEROID_REASON },
  { canonical: "hydrocortisone", display: "Hydrocortisone", synonyms: ["hydrocortisone", "hydrocortisone acetate"], drugClass: "Corticosteroid", indications: ["Inflammation", "Allergy"], preferredCategory: null, uncertainReason: STEROID_REASON },
  { canonical: "mometasone furoate", display: "Mometasone Furoate", synonyms: ["mometasone furoate", "mometasone"], drugClass: "Corticosteroid", indications: ["Inflammation", "Allergy"], preferredCategory: null, uncertainReason: STEROID_REASON },
  { canonical: "clobetasol propionate", display: "Clobetasol Propionate", synonyms: ["clobetasol propionate", "clobetasol"], drugClass: "Corticosteroid", indications: ["Inflammation"], preferredCategory: null, uncertainReason: STEROID_REASON },
  { canonical: "prednicarbate", display: "Prednicarbate", synonyms: ["prednicarbate"], drugClass: "Corticosteroid", indications: ["Inflammation"], preferredCategory: null, uncertainReason: STEROID_REASON },
  { canonical: "loteprednol", display: "Loteprednol", synonyms: ["loteprednol", "loteprednol etabonate"], drugClass: "Corticosteroid (ophthalmic)", indications: ["Inflammation"], preferredCategory: null, uncertainReason: STEROID_REASON },
  { canonical: "budesonide", display: "Budesonide", synonyms: ["budesonide"], drugClass: "Corticosteroid", indications: ["Inflammation", "Respiratory/Asthma"], preferredCategory: null, uncertainReason: STEROID_REASON },
  { canonical: "fluticasone propionate", display: "Fluticasone Propionate", synonyms: ["fluticasone propionate", "fluticasone"], drugClass: "Corticosteroid", indications: ["Respiratory/Asthma", "Allergy"], preferredCategory: null, uncertainReason: STEROID_REASON },
  // ── Local anaesthetics (deferred) ──
  { canonical: "cinchocaine", display: "Cinchocaine", synonyms: ["cinchocaine", "dibucaine"], drugClass: "Local anaesthetic", indications: ["Pain", "Anaesthesia"], preferredCategory: null, uncertainReason: "Local anaesthetic used across hemorrhoid/topical products — ambiguous shelf." },
  { canonical: "lidocaine", display: "Lidocaine", synonyms: ["lidocaine", "lignocaine"], drugClass: "Local anaesthetic", indications: ["Pain", "Anaesthesia"], preferredCategory: null, uncertainReason: "Local anaesthetic used across many product types — ambiguous shelf." },
  // ── Acne / dermatology (deferred) ──
  { canonical: "adapalene", display: "Adapalene", synonyms: ["adapalene"], drugClass: "Topical retinoid", indications: ["Acne"], preferredCategory: null, uncertainReason: "Acne topical — no dedicated acne shelf." },
  { canonical: "tretinoin", display: "Tretinoin", synonyms: ["tretinoin", "retinoic acid", "all-trans retinoic acid"], drugClass: "Topical retinoid", indications: ["Acne"], preferredCategory: null, uncertainReason: "Acne/retinoid topical — no dedicated acne shelf." },
  { canonical: "azelaic acid", display: "Azelaic Acid", synonyms: ["azelaic acid"], drugClass: "Topical acne agent", indications: ["Acne"], preferredCategory: null, uncertainReason: "Acne topical — no dedicated acne shelf." },
  { canonical: "benzoyl peroxide", display: "Benzoyl Peroxide", synonyms: ["benzoyl peroxide"], drugClass: "Topical acne agent", indications: ["Acne"], preferredCategory: null, uncertainReason: "Acne topical — no dedicated acne shelf." },
  { canonical: "tacrolimus", display: "Tacrolimus", synonyms: ["tacrolimus"], drugClass: "Topical immunomodulator", indications: ["Inflammation"], preferredCategory: null, uncertainReason: "Topical immunomodulator (eczema) — no clean shelf." },
  // ── GI protectants / antacids / laxatives / antidiarrheals ──
  { canonical: "sucralfate", display: "Sucralfate", synonyms: ["sucralfate"], drugClass: "Gastroprotective", indications: ["Gastric ulcer"], preferredCategory: CAT.GASTROPROTECT },
  { canonical: "teprenone", display: "Teprenone", synonyms: ["teprenone"], drugClass: "Gastroprotective", indications: ["Gastric ulcer"], preferredCategory: CAT.GASTROPROTECT },
  { canonical: "calcium carbonate", display: "Calcium Carbonate", synonyms: ["calcium carbonate"], drugClass: "Antacid", indications: ["Acid reflux/Gastric acid"], preferredCategory: CAT.ANTACID },
  { canonical: "aluminium hydroxide", display: "Aluminium Hydroxide", synonyms: ["aluminium hydroxide", "aluminum hydroxide"], drugClass: "Antacid", indications: ["Acid reflux/Gastric acid"], preferredCategory: CAT.ANTACID },
  { canonical: "magnesium hydroxide", display: "Magnesium Hydroxide", synonyms: ["magnesium hydroxide"], drugClass: "Antacid", indications: ["Acid reflux/Gastric acid"], preferredCategory: CAT.ANTACID },
  { canonical: "bisacodyl", display: "Bisacodyl", synonyms: ["bisacodyl"], drugClass: "Stimulant laxative", indications: ["Constipation"], preferredCategory: CAT.LAXATIVE },
  { canonical: "lactulose", display: "Lactulose", synonyms: ["lactulose"], drugClass: "Osmotic laxative", indications: ["Constipation"], preferredCategory: CAT.LAXATIVE },
  { canonical: "docusate sodium", display: "Docusate Sodium", synonyms: ["docusate sodium", "docusate", "dioctyl sodium sulfosuccinate"], drugClass: "Stool softener", indications: ["Constipation"], preferredCategory: CAT.LAXATIVE },
  { canonical: "prucalopride", display: "Prucalopride", synonyms: ["prucalopride"], drugClass: "Prokinetic", indications: ["Constipation", "Gastrointestinal motility"], preferredCategory: CAT.PROKINETIC },
  { canonical: "mebeverine", display: "Mebeverine", synonyms: ["mebeverine"], drugClass: "Antispasmodic", indications: ["Abdominal cramps"], preferredCategory: CAT.ANTISPASMODIC },
  { canonical: "peppermint oil", display: "Peppermint Oil", synonyms: ["peppermint oil"], drugClass: "Antispasmodic/Carminative", indications: ["Bloating/Flatulence"], preferredCategory: CAT.CARMINATIVE },
  { canonical: "bismuth subsalicylate", display: "Bismuth Subsalicylate", synonyms: ["bismuth subsalicylate", "bismuth"], drugClass: "Antidiarrheal", indications: ["Diarrhea"], preferredCategory: CAT.DIARRHEA },
  { canonical: "dioctahedral smectite", display: "Dioctahedral Smectite", synonyms: ["dioctahedral smectite", "smectite", "diosmectite"], drugClass: "Antidiarrheal (adsorbent)", indications: ["Diarrhea"], preferredCategory: CAT.DIARRHEA },
  { canonical: "loperamide", display: "Loperamide", synonyms: ["loperamide"], drugClass: "Antidiarrheal", indications: ["Diarrhea"], preferredCategory: CAT.ANTIDIARRHEAL },
  { canonical: "racecadotril", display: "Racecadotril", synonyms: ["racecadotril", "acetorphan"], drugClass: "Antidiarrheal", indications: ["Diarrhea"], preferredCategory: CAT.ANTIDIARRHEAL },
  { canonical: "activated charcoal", display: "Activated Charcoal", synonyms: ["activated charcoal", "activated carbon"], drugClass: "Adsorbent", indications: ["Diarrhea", "Bloating/Flatulence"], preferredCategory: CAT.CHARCOAL },
  // ── Antibacterials / antifungals / antivirals ──
  { canonical: "cloxacillin", display: "Cloxacillin", synonyms: ["cloxacillin"], drugClass: "Antibiotic (Penicillin)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "bacitracin", display: "Bacitracin", synonyms: ["bacitracin"], drugClass: "Antibiotic (topical)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "fusidic acid", display: "Fusidic Acid", synonyms: ["fusidic acid", "sodium fusidate"], drugClass: "Antibiotic", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "gentamicin", display: "Gentamicin", synonyms: ["gentamicin", "gentamycin"], drugClass: "Antibiotic (Aminoglycoside)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "neomycin", display: "Neomycin", synonyms: ["neomycin"], drugClass: "Antibiotic (Aminoglycoside)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "amikacin", display: "Amikacin", synonyms: ["amikacin"], drugClass: "Antibiotic (Aminoglycoside)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "chloramphenicol", display: "Chloramphenicol", synonyms: ["chloramphenicol"], drugClass: "Antibiotic", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "mupirocin", display: "Mupirocin", synonyms: ["mupirocin"], drugClass: "Antibiotic (topical)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "silver sulfadiazine", display: "Silver Sulfadiazine", synonyms: ["silver sulfadiazine", "silver sulphadiazine"], drugClass: "Antibacterial (burn)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "sulfanilamide", display: "Sulfanilamide", synonyms: ["sulfanilamide"], drugClass: "Antibacterial (Sulfonamide)", indications: ["Bacterial infection"], preferredCategory: CAT.ANTIBIOTIC },
  { canonical: "clioquinol", display: "Clioquinol", synonyms: ["clioquinol", "iodochlorhydroxyquin"], drugClass: "Antifungal/Antibacterial (topical)", indications: ["Fungal infection"], preferredCategory: CAT.ANTIFUNGAL },
  { canonical: "terbinafine", display: "Terbinafine", synonyms: ["terbinafine"], drugClass: "Antifungal", indications: ["Fungal infection"], preferredCategory: CAT.ANTIFUNGAL },
  { canonical: "tolnaftate", display: "Tolnaftate", synonyms: ["tolnaftate"], drugClass: "Antifungal", indications: ["Fungal infection"], preferredCategory: CAT.ANTIFUNGAL },
  { canonical: "isoconazole", display: "Isoconazole", synonyms: ["isoconazole"], drugClass: "Antifungal", indications: ["Fungal infection"], preferredCategory: CAT.ANTIFUNGAL },
  { canonical: "acyclovir", display: "Acyclovir", synonyms: ["acyclovir", "aciclovir"], drugClass: "Antiviral", indications: ["Viral infection"], preferredCategory: CAT.ANTIVIRAL },
  { canonical: "albendazole", display: "Albendazole", synonyms: ["albendazole"], drugClass: "Anthelmintic", indications: ["Parasitic infection"], preferredCategory: CAT.ANTIHELMINTH },
  { canonical: "mebendazole", display: "Mebendazole", synonyms: ["mebendazole"], drugClass: "Anthelmintic", indications: ["Parasitic infection"], preferredCategory: CAT.ANTIHELMINTH },
  // ── Mouth / throat ──
  { canonical: "choline salicylate", display: "Choline Salicylate", synonyms: ["choline salicylate"], drugClass: "Topical analgesic (oral)", indications: ["Mouth ulcer"], preferredCategory: CAT.CANKER },
  { canonical: "amylmetacresol", display: "Amylmetacresol", synonyms: ["amylmetacresol"], drugClass: "Throat antiseptic", indications: ["Sore throat"], preferredCategory: CAT.LOZENGE },
  { canonical: "2,4-dichlorobenzyl alcohol", display: "2,4-Dichlorobenzyl Alcohol", synonyms: ["2,4-dichlorobenzyl alcohol", "dichlorobenzyl alcohol"], drugClass: "Throat antiseptic", indications: ["Sore throat"], preferredCategory: CAT.LOZENGE },
  { canonical: "benzydamine", display: "Benzydamine", synonyms: ["benzydamine", "benzydamine hydrochloride", "benzydamine hcl"], drugClass: "Topical NSAID (throat)", indications: ["Sore throat"], preferredCategory: CAT.LOZENGE },
  // ── Vertigo / migraine / brain / psych / neuro ──
  { canonical: "betahistine", display: "Betahistine", synonyms: ["betahistine", "betahistine mesylate", "betahistine mesilate", "betahistine dihydrochloride"], drugClass: "Anti-vertigo", indications: ["Vertigo"], preferredCategory: CAT.VERTIGO },
  { canonical: "cinnarizine", display: "Cinnarizine", synonyms: ["cinnarizine"], drugClass: "Anti-vertigo", indications: ["Vertigo"], preferredCategory: CAT.VERTIGO },
  { canonical: "flunarizine", display: "Flunarizine", synonyms: ["flunarizine"], drugClass: "Migraine prophylaxis", indications: ["Migraine"], preferredCategory: CAT.MIGRAINE },
  { canonical: "sumatriptan", display: "Sumatriptan", synonyms: ["sumatriptan"], drugClass: "Triptan", indications: ["Migraine"], preferredCategory: CAT.MIGRAINE },
  { canonical: "eletriptan", display: "Eletriptan", synonyms: ["eletriptan"], drugClass: "Triptan", indications: ["Migraine"], preferredCategory: CAT.MIGRAINE },
  { canonical: "nicergoline", display: "Nicergoline", synonyms: ["nicergoline"], drugClass: "Cerebral vasodilator", indications: ["Cognitive/Brain"], preferredCategory: CAT.BRAIN },
  { canonical: "piracetam", display: "Piracetam", synonyms: ["piracetam"], drugClass: "Nootropic", indications: ["Cognitive/Brain"], preferredCategory: CAT.BRAIN },
  { canonical: "ginkgo biloba", display: "Ginkgo Biloba", synonyms: ["ginkgo biloba", "ginkgo"], drugClass: "Herbal nootropic", indications: ["Cognitive/Brain"], preferredCategory: CAT.BRAIN },
  { canonical: "donepezil", display: "Donepezil", synonyms: ["donepezil"], drugClass: "Cholinesterase inhibitor", indications: ["Dementia"], preferredCategory: CAT.BRAIN },
  { canonical: "memantine", display: "Memantine", synonyms: ["memantine"], drugClass: "NMDA antagonist", indications: ["Dementia"], preferredCategory: CAT.BRAIN },
  { canonical: "escitalopram", display: "Escitalopram", synonyms: ["escitalopram"], drugClass: "Antidepressant (SSRI)", indications: ["Depression/Anxiety"], preferredCategory: CAT.PSYCH },
  { canonical: "sertraline", display: "Sertraline", synonyms: ["sertraline"], drugClass: "Antidepressant (SSRI)", indications: ["Depression/Anxiety"], preferredCategory: CAT.PSYCH },
  { canonical: "fluoxetine", display: "Fluoxetine", synonyms: ["fluoxetine"], drugClass: "Antidepressant (SSRI)", indications: ["Depression/Anxiety"], preferredCategory: CAT.PSYCH },
  { canonical: "duloxetine", display: "Duloxetine", synonyms: ["duloxetine"], drugClass: "Antidepressant (SNRI)", indications: ["Depression/Anxiety"], preferredCategory: CAT.PSYCH },
  { canonical: "bupropion", display: "Bupropion", synonyms: ["bupropion"], drugClass: "Antidepressant", indications: ["Depression/Anxiety"], preferredCategory: CAT.PSYCH },
  { canonical: "nortriptyline", display: "Nortriptyline", synonyms: ["nortriptyline"], drugClass: "Antidepressant (TCA)", indications: ["Depression/Anxiety"], preferredCategory: CAT.PSYCH },
  { canonical: "amitriptyline", display: "Amitriptyline", synonyms: ["amitriptyline"], drugClass: "Antidepressant (TCA)", indications: ["Depression/Anxiety"], preferredCategory: CAT.PSYCH },
  { canonical: "quetiapine", display: "Quetiapine", synonyms: ["quetiapine"], drugClass: "Antipsychotic", indications: ["Psychiatric"], preferredCategory: CAT.PSYCH },
  { canonical: "levetiracetam", display: "Levetiracetam", synonyms: ["levetiracetam"], drugClass: "Anticonvulsant", indications: ["Seizure"], preferredCategory: CAT.ANTICONVULSANT },
  { canonical: "sodium valproate", display: "Sodium Valproate", synonyms: ["sodium valproate", "valproate", "valproic acid", "divalproex"], drugClass: "Anticonvulsant", indications: ["Seizure"], preferredCategory: CAT.ANTICONVULSANT },
  { canonical: "phenytoin", display: "Phenytoin", synonyms: ["phenytoin"], drugClass: "Anticonvulsant", indications: ["Seizure"], preferredCategory: CAT.ANTICONVULSANT },
  { canonical: "melatonin", display: "Melatonin", synonyms: ["melatonin", "circadin"], drugClass: "Hypnotic (melatonin)", indications: ["Insomnia"], preferredCategory: null, uncertainReason: "No dedicated sleep-aid shelf." },
  { canonical: "tramadol", display: "Tramadol", synonyms: ["tramadol"], drugClass: "Opioid analgesic", indications: ["Pain"], preferredCategory: CAT.PAIN },
  { canonical: "acemetacin", display: "Acemetacin", synonyms: ["acemetacin"], drugClass: "NSAID", indications: ["Pain", "Inflammation"], preferredCategory: CAT.PAIN },
  { canonical: "flurbiprofen", display: "Flurbiprofen", synonyms: ["flurbiprofen"], drugClass: "NSAID", indications: ["Pain", "Inflammation"], preferredCategory: CAT.PAIN },
  // ── Diabetes ──
  { canonical: "pioglitazone", display: "Pioglitazone", synonyms: ["pioglitazone"], drugClass: "Antidiabetic (TZD)", indications: ["Diabetes"], preferredCategory: CAT.DIABETES },
  { canonical: "sitagliptin", display: "Sitagliptin", synonyms: ["sitagliptin"], drugClass: "Antidiabetic (DPP-4)", indications: ["Diabetes"], preferredCategory: CAT.DIABETES },
  { canonical: "vildagliptin", display: "Vildagliptin", synonyms: ["vildagliptin"], drugClass: "Antidiabetic (DPP-4)", indications: ["Diabetes"], preferredCategory: CAT.DIABETES },
  { canonical: "empagliflozin", display: "Empagliflozin", synonyms: ["empagliflozin"], drugClass: "Antidiabetic (SGLT2)", indications: ["Diabetes"], preferredCategory: CAT.DIABETES },
  { canonical: "dapagliflozin", display: "Dapagliflozin", synonyms: ["dapagliflozin"], drugClass: "Antidiabetic (SGLT2)", indications: ["Diabetes"], preferredCategory: CAT.DIABETES },
  { canonical: "glipizide", display: "Glipizide", synonyms: ["glipizide"], drugClass: "Antidiabetic (Sulfonylurea)", indications: ["Diabetes"], preferredCategory: CAT.DIABETES },
  { canonical: "glimepiride", display: "Glimepiride", synonyms: ["glimepiride"], drugClass: "Antidiabetic (Sulfonylurea)", indications: ["Diabetes"], preferredCategory: CAT.DIABETES },
  { canonical: "gliclazide", display: "Gliclazide", synonyms: ["gliclazide"], drugClass: "Antidiabetic (Sulfonylurea)", indications: ["Diabetes"], preferredCategory: CAT.DIABETES },
  // ── Urology / BPH / hair / uric ──
  { canonical: "tamsulosin", display: "Tamsulosin", synonyms: ["tamsulosin"], drugClass: "Alpha blocker", indications: ["BPH"], preferredCategory: CAT.PROSTATE },
  { canonical: "alfuzosin", display: "Alfuzosin", synonyms: ["alfuzosin"], drugClass: "Alpha blocker", indications: ["BPH"], preferredCategory: CAT.PROSTATE },
  { canonical: "doxazosin", display: "Doxazosin", synonyms: ["doxazosin"], drugClass: "Alpha blocker", indications: ["BPH", "Hypertension"], preferredCategory: CAT.PROSTATE },
  { canonical: "prazosin", display: "Prazosin", synonyms: ["prazosin"], drugClass: "Alpha blocker", indications: ["BPH", "Hypertension"], preferredCategory: CAT.PROSTATE },
  { canonical: "dutasteride", display: "Dutasteride", synonyms: ["dutasteride"], drugClass: "5-alpha reductase inhibitor", indications: ["BPH"], preferredCategory: CAT.PROSTATE },
  { canonical: "finasteride", display: "Finasteride", synonyms: ["finasteride"], drugClass: "5-alpha reductase inhibitor", indications: ["BPH", "Hair loss"], preferredCategory: null, uncertainReason: "Dual-use: hair loss (1 mg) vs BPH (5 mg) — ambiguous shelf." },
  { canonical: "minoxidil", display: "Minoxidil", synonyms: ["minoxidil"], drugClass: "Hair growth stimulant", indications: ["Hair loss"], preferredCategory: CAT.HAIR },
  { canonical: "allopurinol", display: "Allopurinol", synonyms: ["allopurinol"], drugClass: "Xanthine oxidase inhibitor", indications: ["Gout/Hyperuricemia"], preferredCategory: CAT.URIC },
  { canonical: "flavoxate", display: "Flavoxate", synonyms: ["flavoxate"], drugClass: "Urinary antispasmodic", indications: ["Overactive bladder"], preferredCategory: null, uncertainReason: "Overactive-bladder antispasmodic — no clean shelf." },
  { canonical: "trospium chloride", display: "Trospium Chloride", synonyms: ["trospium chloride", "trospium"], drugClass: "Urinary antispasmodic", indications: ["Overactive bladder"], preferredCategory: null, uncertainReason: "Overactive-bladder antispasmodic — no clean shelf." },
  { canonical: "orlistat", display: "Orlistat", synonyms: ["orlistat"], drugClass: "Lipase inhibitor (anti-obesity)", indications: ["Weight loss"], preferredCategory: null, uncertainReason: "Anti-obesity agent — no clean shelf." },
  // ── Liver ──
  { canonical: "silymarin", display: "Silymarin", synonyms: ["silymarin", "milk thistle"], drugClass: "Hepatoprotective", indications: ["Liver support"], preferredCategory: CAT.LIVER },
  { canonical: "ursodeoxycholic acid", display: "Ursodeoxycholic Acid", synonyms: ["ursodeoxycholic acid", "udca", "ursodiol"], drugClass: "Bile acid", indications: ["Liver/Gallstone"], preferredCategory: CAT.LIVER },
  // ── Hormones / contraceptives ──
  { canonical: "norethisterone", display: "Norethisterone", synonyms: ["norethisterone", "norethindrone"], drugClass: "Progestogen", indications: ["Female hormone"], preferredCategory: CAT.FEMALE_HORMONE },
  { canonical: "clomifene citrate", display: "Clomifene Citrate", synonyms: ["clomifene citrate", "clomifene", "clomiphene", "clomiphene citrate"], drugClass: "Ovulation inducer", indications: ["Female hormone"], preferredCategory: CAT.FEMALE_HORMONE },
  { canonical: "estradiol valerate", display: "Estradiol Valerate", synonyms: ["estradiol valerate"], drugClass: "Estrogen", indications: ["Female hormone"], preferredCategory: CAT.FEMALE_HORMONE },
  { canonical: "estradiol hemihydrate", display: "Estradiol Hemihydrate", synonyms: ["estradiol hemihydrate", "estradiol"], drugClass: "Estrogen", indications: ["Female hormone"], preferredCategory: CAT.FEMALE_HORMONE },
  { canonical: "progesterone", display: "Progesterone", synonyms: ["progesterone"], drugClass: "Progestogen", indications: ["Female hormone"], preferredCategory: CAT.FEMALE_HORMONE },
  { canonical: "dydrogesterone", display: "Dydrogesterone", synonyms: ["dydrogesterone"], drugClass: "Progestogen", indications: ["Female hormone"], preferredCategory: CAT.FEMALE_HORMONE },
  { canonical: "levonorgestrel", display: "Levonorgestrel", synonyms: ["levonorgestrel"], drugClass: "Progestogen (contraceptive)", indications: ["Contraception"], preferredCategory: CAT.CONTRACEPTIVE },
  { canonical: "norgestrel", display: "Norgestrel", synonyms: ["norgestrel"], drugClass: "Progestogen (contraceptive)", indications: ["Contraception"], preferredCategory: CAT.CONTRACEPTIVE },
  { canonical: "desogestrel", display: "Desogestrel", synonyms: ["desogestrel"], drugClass: "Progestogen (contraceptive)", indications: ["Contraception"], preferredCategory: CAT.CONTRACEPTIVE },
  { canonical: "gestodene", display: "Gestodene", synonyms: ["gestodene"], drugClass: "Progestogen (contraceptive)", indications: ["Contraception"], preferredCategory: CAT.CONTRACEPTIVE },
  { canonical: "norgestimate", display: "Norgestimate", synonyms: ["norgestimate"], drugClass: "Progestogen (contraceptive)", indications: ["Contraception"], preferredCategory: CAT.CONTRACEPTIVE },
  { canonical: "drospirenone", display: "Drospirenone", synonyms: ["drospirenone"], drugClass: "Progestogen (contraceptive)", indications: ["Contraception"], preferredCategory: CAT.CONTRACEPTIVE },
  { canonical: "dienogest", display: "Dienogest", synonyms: ["dienogest"], drugClass: "Progestogen", indications: ["Contraception", "Endometriosis"], preferredCategory: CAT.CONTRACEPTIVE },
  { canonical: "cyproterone acetate", display: "Cyproterone Acetate", synonyms: ["cyproterone acetate", "cyproterone"], drugClass: "Antiandrogen/Progestogen", indications: ["Contraception"], preferredCategory: CAT.CONTRACEPTIVE },
  { canonical: "ethinyl estradiol", display: "Ethinyl Estradiol", synonyms: ["ethinyl estradiol", "ethinylestradiol", "ethinyl oestradiol"], drugClass: "Estrogen (contraceptive)", indications: ["Contraception"], preferredCategory: CAT.CONTRACEPTIVE },
  // ── Eye / ENT ──
  { canonical: "timolol", display: "Timolol", synonyms: ["timolol"], drugClass: "Beta blocker (ophthalmic)", indications: ["Glaucoma"], preferredCategory: CAT.EYE_DROP },
  { canonical: "olopatadine", display: "Olopatadine", synonyms: ["olopatadine"], drugClass: "Antihistamine (ophthalmic)", indications: ["Allergy"], preferredCategory: CAT.ANTIHISTAMINE },
  { canonical: "antazoline", display: "Antazoline", synonyms: ["antazoline"], drugClass: "Antihistamine (ophthalmic)", indications: ["Allergy"], preferredCategory: CAT.ANTIHISTAMINE },
  { canonical: "naphazoline", display: "Naphazoline", synonyms: ["naphazoline"], drugClass: "Decongestant (ophthalmic)", indications: ["Eye redness"], preferredCategory: null, uncertainReason: "Eye-redness decongestant drops — ambiguous shelf." },
  { canonical: "oxymetazoline", display: "Oxymetazoline", synonyms: ["oxymetazoline"], drugClass: "Nasal decongestant", indications: ["Nasal congestion"], preferredCategory: CAT.NASAL },
  { canonical: "xylometazoline", display: "Xylometazoline", synonyms: ["xylometazoline"], drugClass: "Nasal decongestant", indications: ["Nasal congestion"], preferredCategory: CAT.NASAL },
  { canonical: "hypromellose", display: "Hypromellose", synonyms: ["hypromellose", "hpmc", "hydroxypropyl methylcellulose"], drugClass: "Ocular lubricant", indications: ["Dry eye"], preferredCategory: CAT.ARTIFICIAL_TEARS },
  { canonical: "carboxymethylcellulose", display: "Carboxymethylcellulose", synonyms: ["carboxymethylcellulose", "cmc", "carmellose", "carmellose sodium"], drugClass: "Ocular lubricant", indications: ["Dry eye"], preferredCategory: CAT.ARTIFICIAL_TEARS },
  { canonical: "sodium hyaluronate", display: "Sodium Hyaluronate", synonyms: ["sodium hyaluronate", "hyaluronic acid", "hyaluronate"], drugClass: "Lubricant (multi-use)", indications: ["Dry eye"], preferredCategory: null, uncertainReason: "Used in eye drops, joints, and cosmetics — ambiguous shelf." },
  // ── Respiratory / thyroid ──
  { canonical: "salbutamol", display: "Salbutamol", synonyms: ["salbutamol", "albuterol"], drugClass: "Beta-2 agonist (Bronchodilator)", indications: ["Respiratory/Asthma"], preferredCategory: CAT.BRONCHODILATOR },
  { canonical: "salmeterol", display: "Salmeterol", synonyms: ["salmeterol"], drugClass: "Beta-2 agonist (LABA)", indications: ["Respiratory/Asthma"], preferredCategory: CAT.BRONCHODILATOR },
  { canonical: "formoterol", display: "Formoterol", synonyms: ["formoterol", "eformoterol"], drugClass: "Beta-2 agonist (LABA)", indications: ["Respiratory/Asthma"], preferredCategory: CAT.BRONCHODILATOR },
  { canonical: "levothyroxine", display: "Levothyroxine", synonyms: ["levothyroxine", "thyroxine"], drugClass: "Thyroid hormone", indications: ["Hypothyroidism"], preferredCategory: CAT.THYROID },
  { canonical: "propylthiouracil", display: "Propylthiouracil", synonyms: ["propylthiouracil", "ptu"], drugClass: "Antithyroid", indications: ["Hyperthyroidism"], preferredCategory: CAT.THYROID },
  { canonical: "methimazole", display: "Methimazole", synonyms: ["methimazole", "mmi", "thiamazole"], drugClass: "Antithyroid", indications: ["Hyperthyroidism"], preferredCategory: CAT.THYROID },
  // ── Blood / circulation ──
  { canonical: "pentoxifylline", display: "Pentoxifylline", synonyms: ["pentoxifylline", "oxpentifylline"], drugClass: "Hemorheologic agent", indications: ["Circulation"], preferredCategory: CAT.BLOOD },
  { canonical: "ferrous sulfate", display: "Ferrous Sulfate", synonyms: ["ferrous sulfate", "ferrous sulphate"], drugClass: "Iron supplement", indications: ["Anemia"], preferredCategory: CAT.BLOOD },
  { canonical: "ferrous fumarate", display: "Ferrous Fumarate", synonyms: ["ferrous fumarate"], drugClass: "Iron supplement", indications: ["Anemia"], preferredCategory: CAT.BLOOD },
  { canonical: "ferrous gluconate", display: "Ferrous Gluconate", synonyms: ["ferrous gluconate"], drugClass: "Iron supplement", indications: ["Anemia"], preferredCategory: CAT.BLOOD },
  // ── Vitamins / supplements ──
  { canonical: "mecobalamin", display: "Mecobalamin", synonyms: ["mecobalamin", "methylcobalamin", "methycobal", "cyanocobalamin", "vitamin b12"], drugClass: "Vitamin B12", indications: ["Vitamin", "Neuropathy"], preferredCategory: CAT.VITAMIN },
  { canonical: "vitamin c", display: "Vitamin C", synonyms: [
    "vitamin c", "ascorbic acid", "l-ascorbic acid", "ascorbate", "sodium ascorbate", "calcium ascorbate",
    "magnesium ascorbate", "potassium ascorbate", "zinc ascorbate", "manganese ascorbate", "buffered vitamin c",
    "ester-c", "liposomal vitamin c", "liposome vitamin c", "encapsulated vitamin c", "ascorbyl palmitate",
    "ascorbyl glucoside", "sodium ascorbyl phosphate", "magnesium ascorbyl phosphate", "tetrahexyldecyl ascorbate",
    "ascorbyl tetraisopalmitate", "ethyl ascorbic acid", "3-o-ethyl ascorbic acid", "retinyl ascorbate", "dehydroascorbic acid",
  ], drugClass: "Vitamin", indications: ["Vitamin"], preferredCategory: CAT.VITAMIN },
  { canonical: "chamomile", display: "Chamomile", synonyms: ["chamomile", "matricaria"], drugClass: "Herbal", indications: ["Herbal"], preferredCategory: CAT.HERBAL },
  // ── Guaifenesin family + guaiacol derivatives (expectorants) ──
  { canonical: "guaifenesin", display: "Guaifenesin", synonyms: ["guaifenesin", "guaiphenesin", "glyceryl guaiacolate", "guaiacol glyceryl ether", "glycerol guaiacolate", "gge"], drugClass: "Expectorant", indications: ["Mucus/Phlegm"], preferredCategory: CAT.MUCOLYTIC },
  { canonical: "guaiacol", display: "Guaiacol", synonyms: ["guaiacol"], drugClass: "Expectorant", indications: ["Mucus/Phlegm"], preferredCategory: CAT.MUCOLYTIC },
  { canonical: "potassium guaiacolsulfonate", display: "Potassium Guaiacolsulfonate", synonyms: ["potassium guaiacolsulfonate", "potassium guaiacolsulphonate"], drugClass: "Expectorant", indications: ["Mucus/Phlegm"], preferredCategory: CAT.MUCOLYTIC },
  { canonical: "sodium guaiacolsulfonate", display: "Sodium Guaiacolsulfonate", synonyms: ["sodium guaiacolsulfonate", "sodium guaiacolsulphonate"], drugClass: "Expectorant", indications: ["Mucus/Phlegm"], preferredCategory: CAT.MUCOLYTIC },
  { canonical: "guaiacol carbonate", display: "Guaiacol Carbonate", synonyms: ["guaiacol carbonate", "duotal"], drugClass: "Expectorant", indications: ["Mucus/Phlegm"], preferredCategory: CAT.MUCOLYTIC },
  { canonical: "creosotal", display: "Creosotal", synonyms: ["creosotal", "creosote carbonate"], drugClass: "Expectorant", indications: ["Mucus/Phlegm"], preferredCategory: CAT.MUCOLYTIC },
  // ── Antihistamines / mast cell ──
  { canonical: "pheniramine", display: "Pheniramine", synonyms: ["pheniramine", "pheniramine maleate"], drugClass: "Antihistamine", indications: ["Allergy"], preferredCategory: CAT.ANTIHISTAMINE },
  { canonical: "disodium cromoglycate", display: "Disodium Cromoglycate", synonyms: ["disodium cromoglycate", "sodium cromoglicate", "cromolyn", "cromoglicic acid"], drugClass: "Mast cell stabilizer", indications: ["Allergy"], preferredCategory: CAT.ANTIHISTAMINE },
  // ── Smoking cessation ──
  { canonical: "nicotine", display: "Nicotine", synonyms: ["nicotine"], drugClass: "Smoking cessation (NRT)", indications: ["Smoking cessation"], preferredCategory: CAT.SMOKING },
  { canonical: "cytisine", display: "Cytisine", synonyms: ["cytisine", "cytisinicline"], drugClass: "Smoking cessation", indications: ["Smoking cessation"], preferredCategory: CAT.SMOKING },
  // ── Misc deferred ──
  { canonical: "ammonium citrate", display: "Ammonium Citrate", synonyms: ["ammonium citrate", "ferric ammonium citrate"], drugClass: "Iron salt/Expectorant", indications: ["Supplement"], preferredCategory: null, uncertainReason: "Ambiguous use (iron salt vs expectorant)." },
  { canonical: "chelated magnesium", display: "Chelated Magnesium", synonyms: ["chelated magnesium", "magnesium bisglycinate", "magnesium glycinate"], drugClass: "Mineral supplement", indications: ["Supplement"], preferredCategory: null, uncertainReason: "Broad mineral supplement — deferred (consistent with earlier magnesium decision)." },
  { canonical: "chlorhexidine", display: "Chlorhexidine", synonyms: ["chlorhexidine", "chlorhexidine gluconate"], drugClass: "Antiseptic", indications: ["Antiseptic"], preferredCategory: null, uncertainReason: "Broad antiseptic (mouthwash/skin) — ambiguous shelf." },
];

// ── env / db (shared pattern) ─────────────────────────────────────────────────
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

// ── upsert helpers ────────────────────────────────────────────────────────────
async function loadCategorySet(client) {
  const result = await client.query(`
    SELECT DISTINCT category_name FROM ada.product_category_states
    WHERE review_status IN ('confirmed', 'imported_exact_match')
      AND category_name IS NOT NULL AND BTRIM(category_name) <> ''
  `);
  return new Set(result.rows.map((r) => r.category_name));
}

async function upsertIngredient(client, { canonical, display }) {
  const r = await client.query(
    `INSERT INTO knowledge.ingredients (canonical_name, display_name, status, updated_at)
     VALUES ($1, $2, 'active', now())
     ON CONFLICT (canonical_name) DO UPDATE SET display_name = EXCLUDED.display_name, status = 'active', updated_at = now()
     RETURNING ingredient_id, (xmax = 0) AS inserted`,
    [canonical, display],
  );
  return { id: Number(r.rows[0].ingredient_id), inserted: r.rows[0].inserted };
}

async function insertSynonymIfMissing(client, { ingredientId, synonymText }) {
  const r = await client.query(
    `INSERT INTO knowledge.ingredient_synonyms (ingredient_id, synonym_text, language, source, status, updated_at)
     SELECT $1, $2, 'en', $3, 'active', now()
     WHERE NOT EXISTS (SELECT 1 FROM knowledge.ingredient_synonyms WHERE LOWER(BTRIM(synonym_text)) = LOWER(BTRIM($2)))
     RETURNING synonym_id`,
    [ingredientId, synonymText, SOURCE],
  );
  return r.rowCount > 0;
}

async function upsertDrugClass(client, name) {
  const r = await client.query(
    `INSERT INTO knowledge.drug_classes (name, status, updated_at) VALUES ($1, 'active', now())
     ON CONFLICT (name) DO UPDATE SET status = 'active', updated_at = now()
     RETURNING drug_class_id, (xmax = 0) AS inserted`,
    [name],
  );
  return { id: Number(r.rows[0].drug_class_id), inserted: r.rows[0].inserted };
}

async function upsertIndication(client, name) {
  const r = await client.query(
    `INSERT INTO knowledge.indications (name, status, updated_at) VALUES ($1, 'active', now())
     ON CONFLICT (name) DO UPDATE SET status = 'active', updated_at = now()
     RETURNING indication_id, (xmax = 0) AS inserted`,
    [name],
  );
  return { id: Number(r.rows[0].indication_id), inserted: r.rows[0].inserted };
}

async function upsertIngredientDrugClass(client, { ingredientId, drugClassId }) {
  const r = await client.query(
    `INSERT INTO knowledge.ingredient_drug_classes (ingredient_id, drug_class_id, confidence, source, status, confirmed_by, confirmed_at, updated_at)
     VALUES ($1, $2, 1, $3, 'confirmed', $3, now(), now())
     ON CONFLICT (ingredient_id, drug_class_id) DO UPDATE SET source = EXCLUDED.source, status = 'confirmed', updated_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [ingredientId, drugClassId, SOURCE],
  );
  return r.rows[0].inserted;
}

async function upsertIngredientIndication(client, { ingredientId, indicationId }) {
  const r = await client.query(
    `INSERT INTO knowledge.ingredient_indications (ingredient_id, indication_id, source, status, confirmed_by, confirmed_at, updated_at)
     VALUES ($1, $2, $3, 'confirmed', $3, now(), now())
     ON CONFLICT (ingredient_id, indication_id) DO UPDATE SET source = EXCLUDED.source, status = 'confirmed', updated_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [ingredientId, indicationId, SOURCE],
  );
  return r.rows[0].inserted;
}

async function insertCategoryRuleIfMissing(client, { ingredientId, categoryName, priority, note }) {
  const r = await client.query(
    `INSERT INTO knowledge.ingredient_category_rules (ingredient_id, drug_class_id, indication_id, category_name, priority, rule_status, note, created_by, updated_at)
     SELECT $1, NULL, NULL, $2, $3, 'active', $4, $5, now()
     WHERE NOT EXISTS (
       SELECT 1 FROM knowledge.ingredient_category_rules
       WHERE ingredient_id = $1 AND drug_class_id IS NULL AND indication_id IS NULL AND category_name = $2 AND created_by = $5
     )
     RETURNING rule_id`,
    [ingredientId, categoryName, priority, note, SOURCE],
  );
  return r.rowCount > 0;
}

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

      const resolvedCategory = def.preferredCategory && categorySet.has(def.preferredCategory) ? def.preferredCategory : null;
      if (resolvedCategory) {
        const ruleInserted = await insertCategoryRuleIfMissing(client, {
          ingredientId: ing.id, categoryName: resolvedCategory, priority: 20,
          note: `Batch 3 ingredient rule: ${def.display} -> ${def.drugClass} -> ${resolvedCategory}`,
        });
        if (ruleInserted) stats.categoryRules.inserted += 1; else stats.categoryRules.skipped += 1;
      } else {
        stats.uncertainCategoryMappings.push({
          ingredient: def.display, drugClass: def.drugClass, preferredCategory: def.preferredCategory,
          reason: def.uncertainReason || (def.preferredCategory ? `Preferred category "${def.preferredCategory}" not found among confirmed/imported categories` : "No clearly suitable existing category (deferred)"),
        });
      }
    }

    if (commit) await client.query("COMMIT"); else await client.query("ROLLBACK");
    return stats;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function printSummary(stats) {
  const lines = [];
  lines.push("==================================================");
  lines.push(` INGREDIENT DICTIONARY SEED — BATCH 3  [${stats.mode.toUpperCase()}]`);
  lines.push("==================================================");
  lines.push(`Total input terms (FADAsoft SET 3) : ${stats.totalInputTerms}`);
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
  for (const u of stats.uncertainCategoryMappings) lines.push(`  - ${u.ingredient} (${u.drugClass}): ${u.reason}`);
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
    console.log("node scripts/seed_ingredient_dictionary_batch3.js [--dry-run|--commit] [--db-url <url>]");
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
    console.error(`Batch 3 seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseCliArgs, seed, INGREDIENTS, RAW_TERMS };
