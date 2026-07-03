"use strict";

// Single source of truth for AI Video Content Studio allow-lists. Routes and the
// service layer both import from here so a client can never smuggle an
// unsupported provider/model/duration/aspect-ratio combination past validation.

const ASPECT_RATIOS = ["16:9", "9:16", "1:1"];

// Allow-listed durations (seconds), keyed by provider -> model. Durations genuinely
// differ per Sora model (confirmed against OpenAI's published docs as of 2026-07):
// sora-2 supports 4/8/12s, sora-2-pro supports 10/15/25s. Reconfirm against
// https://platform.openai.com/docs/guides/video-generation before relying on this,
// since OpenAI's documented options have changed across doc revisions.
const ALLOWED_DURATIONS_BY_PROVIDER_MODEL = {
  mock: {
    "mock-v1": [4, 8, 12],
  },
  openai: {
    "sora-2": [4, 8, 12],
    "sora-2-pro": [10, 15, 25],
  },
};

// aspect ratio -> OpenAI "size" string. "pro" sizes require model sora-2-pro.
const ASPECT_RATIO_TO_OPENAI_SIZE = {
  "16:9": { default: "1280x720", pro: "1920x1080" },
  "9:16": { default: "720x1280", pro: "1080x1920" },
  "1:1": { default: "480x480", pro: "480x480" },
};

// Server-side allow-list of provider/model combinations. The route layer rejects
// any client-supplied provider/model pair not present here.
const ALLOWED_PROVIDER_MODELS = {
  mock: ["mock-v1"],
  openai: ["sora-2", "sora-2-pro"],
};

const ASSET_TYPES = ["input_image", "input_video", "generated_video", "thumbnail", "export"];

const MAX_UPLOAD_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

// USD price per second of generated video, keyed by model -> OpenAI "size" string.
// Sourced from OpenAI's published Sora API pricing (Standard tier, non-batch) as of
// 2026-07. Sora 2 Pro at 480x480 has no published tier (that resolution appears to be
// sora-2-only in practice) — priced at the cheapest documented pro tier (720p) as a
// conservative placeholder; reconfirm before relying on this for real billing.
const OPENAI_PRICE_PER_SECOND_USD = {
  "sora-2": {
    "1280x720": 0.1,
    "720x1280": 0.1,
    "480x480": 0.1,
  },
  "sora-2-pro": {
    "1920x1080": 0.7,
    "1080x1920": 0.7,
    "480x480": 0.3, // placeholder — see comment above
  },
};

// Fallback USD->THB rate used only if USD_TO_THB_RATE is not set in the environment.
// This is a display convenience, not a live exchange rate — update
// USD_TO_THB_RATE periodically rather than relying on this default staying accurate.
const DEFAULT_USD_TO_THB_RATE = 36.5;

module.exports = {
  ASPECT_RATIOS,
  ALLOWED_DURATIONS_BY_PROVIDER_MODEL,
  ASPECT_RATIO_TO_OPENAI_SIZE,
  ALLOWED_PROVIDER_MODELS,
  ASSET_TYPES,
  MAX_UPLOAD_MIME_TYPES,
  OPENAI_PRICE_PER_SECOND_USD,
  DEFAULT_USD_TO_THB_RATE,
};
