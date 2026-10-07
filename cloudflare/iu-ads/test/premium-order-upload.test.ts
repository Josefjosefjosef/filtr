import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { handlePublicPremiumOrderUpload } from "../src/public-premium-order";
import type { Env } from "../src/types";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC",
  "base64"
);

function hashToken(token: string, pepper: string): string {
  return createHash("sha256").update(pepper + "|" + token.trim().toUpperCase()).digest("hex");
}

class UploadDb {
  premiumOrder = {
    order_id: "ord_test",
    workflow_status: "submitted",
    creative_mode: "image_large",
    placement_id: "selected_services.aff-auto-moto.premium.03",
    order_token_hash: hashToken("PO-TESTTOKEN", "test-pepper-min-16-chars"),
    creative_id: null as string | null,
  };
  clientOrder = { client_id: "cli_test" };
  creatives = new Map<string, Record<string, unknown>>();

  prepare(sql: string) {
    const self = this;
    return {
      bind(...params: unknown[]) {
        return {
          async first<T>() {
            if (sql.includes("premium_selected_orders WHERE order_id")) {
              return { ...self.premiumOrder } as T;
            }
            if (sql.includes("FROM orders WHERE order_id")) {
              return self.clientOrder as T;
            }
            if (sql.includes("order_token_hash")) {
              return self.premiumOrder.order_token_hash === params[1] ? { order_id: params[0] } : null;
            }
            return null;
          },
          async run() {
            if (sql.startsWith("INSERT INTO creatives")) {
              const creativeId = String(params[0]);
              self.creatives.set(creativeId, {
                creative_id: creativeId,
                format: params[3],
                r2_key: params[9],
                review_status: "pending",
              });
            }
            if (sql.includes("UPDATE premium_selected_orders SET creative_id")) {
              self.premiumOrder.creative_id = String(params[0]);
              self.premiumOrder.workflow_status = "under_review";
            }
            return { success: true, meta: { changes: 1 } };
          },
        };
      },
    };
  }
}

class FakeR2 {
  keys: string[] = [];
  async put(key: string) {
    this.keys.push(key);
  }
}

describe("premium order creative upload", () => {
  it("accepts png upload and links creative to order", async () => {
    const db = new UploadDb();
    const r2 = new FakeR2();
    const env = {
      DB: db as unknown as Env["DB"],
      CREATIVES: r2 as unknown as Env["CREATIVES"],
      ADS_CODE_PEPPER: "test-pepper-min-16-chars",
    } as Env;

    const res = await handlePublicPremiumOrderUpload(
      new Request("https://ads.test/v1/public/premium/orders/ord_test/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-IU-Premium-Order-Token": "PO-TESTTOKEN",
        },
        body: JSON.stringify({
          content_base64: PNG.toString("base64"),
          declared_mime: "image/png",
          filename: "test.png",
          width: 12,
          height: 12,
        }),
      }),
      env,
      "ord_test"
    );
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.creative_id).toBeTruthy();
    expect(body.format).toBe("image_large");
    expect(r2.keys.length).toBe(1);
    expect(db.premiumOrder.workflow_status).toBe("under_review");
    const stored = [...db.creatives.values()][0];
    expect(stored.r2_key).toMatch(/^creative\//);
    expect(stored.r2_key).not.toBe("pending");
  });
});
