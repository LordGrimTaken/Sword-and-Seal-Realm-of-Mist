// Minimal S3-compatible client (Cloudflare R2) using only node built-ins: SigV4 signing by hand.
// Path-style addressing: <endpoint>/<bucket>/<key>. Region "auto" for R2.
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";

const sha256hex = (d) => crypto.createHash("sha256").update(d).digest("hex");
const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (p) => p.split("/").map(enc).join("/");

/** Pure signing function (exported for tests against AWS's published example). Returns the headers to send, incl. Authorization. */
export function signRequest({ method, host, path, query = {}, headers = {}, payloadHash, accessKeyId, secretAccessKey, region = "auto", service = "s3", amzDate }) {
  const date = amzDate.slice(0, 8);
  const h = { ...headers, host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(h).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, " ")]));
  const canonHeaders = names.map((n) => `${n}:${lower[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonQuery = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join("&");
  const canonical = [method, encPath(path), canonQuery, canonHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const sts = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonical)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac("AWS4" + secretAccessKey, date), region), service), "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(sts).digest("hex");
  return { headers: { ...h, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` }, signature, canonical, signedHeaders };
}

export class S3 {
  /** @param {{endpoint:string,bucket:string,accessKeyId:string,secretAccessKey:string,region?:string}} o */
  constructor(o) {
    this.url = new URL(o.endpoint);
    this.bucket = o.bucket; this.accessKeyId = o.accessKeyId; this.secretAccessKey = o.secretAccessKey; this.region = o.region || "auto";
  }
  static fromEnv(env = process.env) {
    const need = (k) => { if (!env[k]) throw new Error(`missing env ${k}`); return env[k]; };
    const endpoint = env.S3_ENDPOINT || `https://${need("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
    return new S3({ endpoint, bucket: env.BACKUP_BUCKET || "sword-and-seal-backups", accessKeyId: need("R2_ACCESS_KEY_ID"), secretAccessKey: need("R2_SECRET_ACCESS_KEY") });
  }
  _request(method, key, { query = {}, headers = {}, body, bodyHash, sink } = {}) {
    const path = `/${this.bucket}${key ? "/" + key : ""}`;
    const payloadHash = bodyHash || sha256hex(body ?? "");
    const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
    const { headers: sh } = signRequest({ method, host: this.url.host, path, query, headers, payloadHash, accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey, region: this.region, amzDate });
    const qs = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join("&");
    const lib = this.url.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      const req = lib.request({ method, hostname: this.url.hostname, port: this.url.port || undefined, path: encPath(path) + (qs ? "?" + qs : ""), headers: sh }, (res) => {
        if (sink && res.statusCode === 200) { res.pipe(sink); sink.on("finish", () => resolve({ status: 200, headers: res.headers })); sink.on("error", reject); res.on("error", reject); return; }
        const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("error", reject);
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      req.setTimeout(120_000, () => req.destroy(new Error("request timeout")));
      if (body && typeof body.pipe === "function") body.pipe(req); else req.end(body);
    });
  }
  _check(r, what) { if (r.status < 200 || r.status >= 300) throw new Error(`${what} failed: HTTP ${r.status} ${r.body ? r.body.toString().slice(0, 300) : ""}`); return r; }
  /** Upload a file from disk (streams the body; the sha256 is computed first because we sign the payload). */
  async putFile(key, file, fs, meta = {}) {
    const size = fs.statSync(file).size;
    const hash = await new Promise((res, rej) => { const h = crypto.createHash("sha256"); fs.createReadStream(file).on("data", (d) => h.update(d)).on("end", () => res(h.digest("hex"))).on("error", rej); });
    const headers = { "content-length": String(size), "content-type": "application/gzip" };
    for (const [k, v] of Object.entries({ sha256: hash, ...meta })) headers[`x-amz-meta-${k}`] = String(v);
    this._check(await this._request("PUT", key, { headers, bodyHash: hash, body: fs.createReadStream(file) }), `PUT ${key}`);
    return { size, sha256: hash };
  }
  async getToFile(key, file, fs) {
    const sink = fs.createWriteStream(file);
    const r = await this._request("GET", key, { sink });
    if (r.status !== 200) { sink.destroy(); this._check(r, `GET ${key}`); }
    return r.headers;
  }
  async head(key) { const r = await this._request("HEAD", key); if (r.status === 404) return null; this._check(r, `HEAD ${key}`); return r.headers; }
  async delete(key) { this._check(await this._request("DELETE", key), `DELETE ${key}`); }
  /** ListObjectsV2 with pagination. Returns [{key,size,lastModified}] */
  async list(prefix) {
    const out = []; let token;
    do {
      const query = { "list-type": "2", prefix, ...(token ? { "continuation-token": token } : {}) };
      const r = this._check(await this._request("GET", "", { query }), "LIST");
      const xml = r.body.toString("utf8");
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const g = (t) => (m[1].match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1];
        out.push({ key: unxml(g("Key")), size: Number(g("Size")), lastModified: g("LastModified") });
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? unxml((xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/) || [])[1]) : undefined;
    } while (token);
    return out;
  }
}
const unxml = (s = "") => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
