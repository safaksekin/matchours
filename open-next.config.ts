import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Basic Cloudflare Workers config for OpenNext.
// To enable ISR/Data-cache later, add an incrementalCache (R2/KV) here.
export default defineCloudflareConfig();
