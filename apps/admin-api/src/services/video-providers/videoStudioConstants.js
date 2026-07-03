"use strict";

// Single source of truth for AI Video Content Studio allow-lists. Routes and the
// service layer both import from here so a client can never smuggle an
// unsupported provider/model/duration/aspect-ratio combination past validation.

const ASPECT_RATIOS = ["16:9", "9:16", "1:1"];

// Small allow-listed durations (seconds). The mock provider accepts any of these
// purely as a simulated range. The openai list should be reconfirmed against
// https://platform.openai.com/docs/guides/video-generation before going live,
// since OpenAI's documented duration options have changed across doc revisions.
const ALLOWED_DURATIONS_BY_PROVIDER = {
  mock: [4, 8, 12],
  openai: [4, 8, 12],
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

module.exports = {
  ASPECT_RATIOS,
  ALLOWED_DURATIONS_BY_PROVIDER,
  ASPECT_RATIO_TO_OPENAI_SIZE,
  ALLOWED_PROVIDER_MODELS,
  ASSET_TYPES,
  MAX_UPLOAD_MIME_TYPES,
};
