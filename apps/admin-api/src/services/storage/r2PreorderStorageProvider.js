"use strict";

const { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

function assertR2Config(config) {
  const missing = [["R2_ACCESS_KEY_ID",config.r2AccessKeyId],["R2_SECRET_ACCESS_KEY",config.r2SecretAccessKey],["R2_ENDPOINT",config.r2Endpoint],["R2_BUCKET_NAME",config.r2BucketName]].filter(([,v])=>!v).map(([k])=>k);
  if (missing.length) throw new Error(`Customer preorders require backend R2 configuration: ${missing.join(", ")}`);
}

function createR2PreorderStorageProvider(config, options = {}) {
  assertR2Config(config);
  const client = options.client || new S3Client({ region: config.r2Region || "auto", endpoint: config.r2Endpoint, credentials: { accessKeyId: config.r2AccessKeyId, secretAccessKey: config.r2SecretAccessKey } });
  const bucket = config.r2BucketName;
  return {
    providerName: "R2", bucket,
    async putObject({ key, body, contentType, checksumSha256 }) { return client.send(new PutObjectCommand({ Bucket:bucket, Key:key, Body:body, ContentType:contentType, ChecksumSHA256:checksumSha256, CacheControl:"private, no-store" })); },
    async headObject(key) { return client.send(new HeadObjectCommand({ Bucket:bucket, Key:key })); },
    async deleteObject(key) { return client.send(new DeleteObjectCommand({ Bucket:bucket, Key:key })); },
    async createSignedGetUrl(key) { return (options.signer || getSignedUrl)(client,new GetObjectCommand({ Bucket:bucket, Key:key, ResponseCacheControl:"private, no-store",ResponseContentDisposition:"inline" }),{ expiresIn:config.r2SignedUrlTtlSeconds || 300 }); },
  };
}
module.exports = { assertR2Config, createR2PreorderStorageProvider };
