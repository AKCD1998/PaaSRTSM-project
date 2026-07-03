"use strict";

const { createLocalDiskStorageProvider } = require("./localDiskStorageProvider");

function getStorageProvider(config) {
  const provider = String(config.videoStorageProvider || "local").trim().toLowerCase();
  if (provider === "local") {
    return createLocalDiskStorageProvider(config);
  }
  throw new Error(
    `Storage provider "${config.videoStorageProvider}" is not configured. Only "local" is implemented; set VIDEO_STORAGE_PROVIDER=local or implement an r2 adapter.`,
  );
}

module.exports = {
  getStorageProvider,
};
