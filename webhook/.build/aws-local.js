// src/aws-local.ts
export function localAwsConfig() {
    const isLocal = process.env.IS_LOCAL === "true" || process.env.IS_OFFLINE === "true" || process.env.LOCALSTACK === "true" || process.env.STAGE === "local";
    const endpoint = process.env.AWS_ENDPOINT_URL || process.env.LOCALSTACK_URL || "http://localhost:4566";
    return isLocal ? { endpoint, region: process.env.AWS_REGION || "us-east-1",
        credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test", secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test" } } : {};
}
