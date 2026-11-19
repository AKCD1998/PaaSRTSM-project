# SCPDA client address behind Render and Cloudflare

On19 November2026, branch004 primary and iPhone enrollment had the same client IP in Render request logs, yet the daily network guard rejected the iPhone. Primary audit entries held Cloudflare proxy addresses because Express's one-hop req.ip stopped at the edge. The primary session was active at version21; the enrollment attempt was within the QR lifetime. No customer IP, QR secret, password or device key is reproduced here.

SCPDA now resolves its client address from the existing trusted Render socket and at most one additional Cloudflare hop. The Cloudflare CIDRs are a bundled snapshot from the public official API https://api.cloudflare.com/client/v4/ips, verified19 November2026. If the nearest additional address is not in that list, resolution stops there. A caller-supplied leftmost prefix and arbitrary deeper Cloudflare-looking addresses are not trusted. Without Express proxy trust, forwarded headers are ignored. IPv4-mapped/IPv6 spelling differences normalize before hashing. Invalid addresses fail closed.

The same scoped resolver is used for daily network HMAC, SCPDA audit IPs and SCPDA rate-limit buckets. Global Express proxy configuration and other application surfaces are unchanged. This preserves the accepted public-IP-plus-signed-QR policy; it does not assert SSID/LAN/hardware attestation.

Existing primary session network references refresh through their next authenticated request, including opening the QR menu. Generate a fresh QR from the primary after rollout; no account/PIN/device reset, database migration, feature flag or Android/PWA rebuild is required. The current version remains21. Existing binding, midnight expiry, scope and selfie retention rules remain.

Tests cover changing Cloudflare IPv4/IPv6 edges with one actual client, genuinely different clients, forged forwarded prefixes, a Cloudflare-exit client, non-Cloudflare hops, disabled trust, canonical address forms and invalid addresses. The full signed HTTP/PostgreSQL daily/count fixture rotates proxy addresses between requests to reproduce the production topology; foreign networks and cross-team requests remain denied.
