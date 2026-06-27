// app/robots.js — allow crawling everything and point crawlers at the sitemap.
import { SITE_URL } from "./_lib/routes";

export default function robots() {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: SITE_URL + "/sitemap.xml",
    host: SITE_URL,
  };
}
