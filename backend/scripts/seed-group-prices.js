#!/usr/bin/env node
/**
 * One-time script: set default prices for paraplan_groups config.
 * Usage: node backend/scripts/seed-group-prices.js
 */

import "dotenv/config";
import { supabase } from "../supabaseClient.js";

const DEFAULTS = {
  "МИНИ-1":    { subscription_price: 3400, single_price: 850,  price_type: "subscription" },
  "МИНИ-2":    { subscription_price: 4000, single_price: 1000, price_type: "subscription" },
  "СТАРТ-1":  { subscription_price: 4000, single_price: 1000, price_type: "subscription" },
  "СТАРТ-2":  { subscription_price: 4000, single_price: 1000, price_type: "subscription" },
  "ПКШК":     { subscription_price: 4000, single_price: 1000, price_type: "subscription" },
  "ГКП":      { subscription_price: null, single_price: 1700, price_type: "single" },
  "ИНГЛИШ":   { subscription_price: 4000, single_price: 1000, price_type: "subscription" },
  "РИСОВАНИЕ":{ subscription_price: 4000, single_price: 1000, price_type: "subscription" },
};

async function main() {
  const tenantId = process.env.DEFAULT_TENANT_ID || "dev";

  // Read current config
  const { data, error } = await supabase
    .from("tenant_settings")
    .select("value")
    .eq("tenant_id", tenantId)
    .eq("key", "paraplan_groups")
    .single();

  if (error) {
    console.error("Failed to read paraplan_groups:", error.message);
    process.exit(1);
  }

  const groups = data.value || [];
  console.log(`Found ${groups.length} groups in config`);

  let updated = 0;
  const newGroups = groups.map((g) => {
    // Match by prefix (e.g. "МИНИ-1", "ГКП", etc.)
    const defaults = DEFAULTS[g.prefix];
    if (!defaults) {
      console.log(`  [skip] ${g.prefix} (${g.name}) — no defaults`);
      return g;
    }
    const patch = { ...g };
    if (!patch.subscription_price && defaults.subscription_price) {
      patch.subscription_price = defaults.subscription_price;
    }
    if (!patch.single_price && defaults.single_price) {
      patch.single_price = defaults.single_price;
    }
    if (!patch.price_type) {
      patch.price_type = defaults.price_type;
    }
    const changed = patch.subscription_price !== g.subscription_price ||
                    patch.single_price !== g.single_price ||
                    patch.price_type !== g.price_type;
    if (changed) {
      updated++;
      console.log(`  [update] ${g.prefix} (${g.name}): sub=${patch.subscription_price}, single=${patch.single_price}, type=${patch.price_type}`);
    } else {
      console.log(`  [ok] ${g.prefix} (${g.name}): already set`);
    }
    return patch;
  });

  if (updated === 0) {
    console.log("No changes needed.");
    process.exit(0);
  }

  // Write back
  const { error: writeErr } = await supabase
    .from("tenant_settings")
    .upsert({
      tenant_id: tenantId,
      key: "paraplan_groups",
      value: newGroups,
      description: "Paraplan groups config (prices seeded)",
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,key" });

  if (writeErr) {
    console.error("Failed to write:", writeErr.message);
    process.exit(1);
  }

  console.log(`Done. Updated ${updated} groups.`);
}

main();
