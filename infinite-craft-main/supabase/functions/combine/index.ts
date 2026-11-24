import * as openaiProvider from "./providers/openai.ts";
// import * as geminiProvider from "./providers/gemini.ts";
const AI_PROVIDER = openaiProvider;

// Supabase Edge Function: combine
// מקבל שני שמות אלמנטים + כינוי שחקן, בודק אם השילוב קיים כבר,
// ואם לא — קורא ל-Gemini ליצור תוצאה חדשה, שומר ומחזיר אותה.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// מפתחות "זרע" קבועים, מופרדים בפסיק, ב-secret בשם GEMINI_API_KEYS (אופציונלי).
// לדוגמה: supabase secrets set GEMINI_API_KEYS="key1,key2,key3"
const SEED_GEMINI_API_KEYS = (Deno.env.get("GEMINI_API_KEYS") ?? Deno.env.get("GEMINI_API_KEY") ?? "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function sortKey(a: string, b: string) {
  return [a, b].sort().join(",");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { itemA, itemB, nickname } = await req.json();
    if (!itemA || !itemB || !nickname) {
      return new Response(JSON.stringify({ error: "חסרים פרמטרים" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const comboKey = sortKey(itemA, itemB);

    // 1. אם השילוב כבר נוסה בעבר (הצליח או נכשל) - החזר את התוצאה השמורה מיד, בלי לפנות ל-Gemini
    const { data: existing } = await supabase
      .from("recipes")
      .select("result_name, discovered_by, failed, elements(emoji)")
      .eq("combo_key", comboKey)
      .maybeSingle();

    if (existing) {
      if (existing.failed) {
        return new Response(
          JSON.stringify({ failed: true, isNew: false }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          name: existing.result_name,
          emoji: existing.elements?.emoji ?? "❓",
          discoveredBy: existing.discovered_by,
          isNew: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. אחרת - שלוף רשימת אלמנטים קיימים, ובקש מ-Gemini תוצאה חדשה
    const { data: existingElements } = await supabase
      .from("elements")
      .select("name")
      .order("created_at", { ascending: true })
      .limit(300);

    const existingNames = (existingElements ?? []).map((e) => e.name);
    const existingListText = existingNames.length
      ? existingNames.join(", ")
      : "(אין עדיין אלמנטים אחרים)";

    // const prompt = AI_PROVIDER.createPrompt(itemA, itemB, existingListText);

    const AI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    if (!AI_API_KEY) {
      return new Response(
        JSON.stringify({
          error: "לא הוגדר OPENAI_API_KEY",
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    let text = "";

    try {
      text = await AI_PROVIDER.generate(
        itemA,
        itemB,
        existingListText,
        AI_API_KEY
      );
    } catch (e) {
      return new Response(
        JSON.stringify({
          error: "שגיאת AI",
          detail: String(e),
        }),
        {
          status: 502,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }
    let parsed: { success?: boolean; name?: string; emoji?: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { success: false };
    }

    // אם ה-AI קבע שאין שילוב הגיוני - שמור את זה (כדי לא לשאול שוב) ותחזיר כישלון
    if (parsed.success === false) {
      await supabase
        .from("recipes")
        .upsert(
          { combo_key: comboKey, item_a: itemA, item_b: itemB, result_name: null, failed: true, discovered_by: null },
          { onConflict: "combo_key", ignoreDuplicates: true }
        );
      return new Response(
        JSON.stringify({ failed: true, isNew: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resultName = (parsed.name || "").trim();
    const geminiEmoji = (parsed.emoji || "❔").trim();

    if (!resultName) {
      // בטיחות: אם חזר "success: true" אבל בלי שם תקין, נתייחס לזה ככישלון ולא נשמור פלוסר ריק
      await supabase
        .from("recipes")
        .upsert(
          { combo_key: comboKey, item_a: itemA, item_b: itemB, result_name: null, failed: true, discovered_by: null },
          { onConflict: "combo_key", ignoreDuplicates: true }
        );
      return new Response(
        JSON.stringify({ failed: true, isNew: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. בדוק אם זה בעצם אלמנט קיים (גם אם ה-AI כתב אימוג'י שונה במקצת)
    const { data: existingElement } = await supabase
      .from("elements")
      .select("name, emoji")
      .eq("name", resultName)
      .maybeSingle();

    const resultEmoji = existingElement?.emoji ?? geminiEmoji;
    const isBrandNewElement = !existingElement;

    // 4. שמור: אלמנט חדש רק אם לא קיים כבר, ותמיד שמור מתכון חדש לצירוף הזה.
    //    זיכוי "מי גילה" נשמר רק אחרי שלב מוקדם מסוים במשחק (לא על העשרות הראשונות),
    //    כדי שלא ייראה מצחיק ששחקן אחד "לוקח" את כל האלמנטים הראשונים.
    const EARLY_GAME_THRESHOLD = 40;
    const { count: totalElementsCount } = await supabase
      .from("elements")
      .select("*", { count: "exact", head: true });
    const pastEarlyGame = (totalElementsCount ?? 0) >= EARLY_GAME_THRESHOLD;
    const creditedNickname = pastEarlyGame ? nickname : null;

    if (isBrandNewElement) {
      await supabase
        .from("elements")
        .upsert({ name: resultName, emoji: resultEmoji, discovered_by: creditedNickname }, { onConflict: "name", ignoreDuplicates: true });
    }

    await supabase
      .from("recipes")
      .upsert(
        {
          combo_key: comboKey,
          item_a: itemA,
          item_b: itemB,
          result_name: resultName,
          discovered_by: creditedNickname,
        },
        { onConflict: "combo_key", ignoreDuplicates: true }
      );

    // isNew מתייחס לאלמנט עצמו: אם הוא כבר קיים (אפילו דרך מתכון אחר),
    // זה "מתכון חדש לאלמנט ידוע" ולא גילוי חדש - כפי שקורה במשחק האמיתי.
    return new Response(
      JSON.stringify({ name: resultName, emoji: resultEmoji, discoveredBy: existingElement?.discovered_by ?? creditedNickname, isNew: isBrandNewElement }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
