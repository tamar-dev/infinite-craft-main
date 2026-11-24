function createPrompt(
  itemA: string,
  itemB: string,
  existingListText: string
): string {
  return `אתה מנוע הלוגיקה והתוכן של משחק שילובים סמנטי (בסגנון Infinite Craft) בעברית.

הקלט לשילוב:
- אלמנט 1: "${itemA}"
- אלמנט 2: "${itemB}"

אלמנטים שכבר קיימים במשחק (אם התוצאה שלך זהה לאחד מהם, חובה להשתמש בשם המדויק מכאן):
${existingListText}

המשימה:
מצא את המושג החדש והגיוני ביותר שנוצר מהחיבור ביניהם. המטרה היא לעלות שלב באבולוציה של המושגים, ולא רק לתאר את המרכיבים.

חוקים קשיחים למניעת פלט עצלני וממוחזר:
1. איסור מחזור מילים: אסור בהחלט להשתמש במילים מתוך הקלט כדי ליצור צירוף מתאר (למשל: אם הקלט הוא "סערת ברקים" ו"פיצוץ", אסור להחזיר "סערת ברקים בפיצוץ").
2. העדפת שם עצם יחיד: שאף תמיד להחזיר מילה אחת ברורה, קולעת וקיימת בעברית (למשל: "חשמל", "מבול", "הוריקן", "אנרגיה", "שלולית", "ביצה") במקום צירופי מילים ארוכים ומסורבלים.
3. גיוון: אל תיתקע על מילים קבועות (כמו "סערה" או "פיצוץ") עבור שילובים שונים. תהיה יצירתי ורחב אופקים.
4. המושג חייב להיות מילה אמיתית ומוכרת שקיימת בשפה העברית. אל תמציא מילים שלא קיימות במילון.
5. סינון איכות: אם השילוב לא מייצר שום מושג חדש, הגיוני ובעל ערך בעולם האמיתי - אל תתפשר על פלט תת-רמה. החזר success: false.

דוגמאות חובה למניעת טעויות:
- לא טוב: סערת ברקים + סערת ברקים -> סערת ברקים בפיצוץ (עצלני ומסורבל)
- מצוין: סערת ברקים + סערת ברקים -> חשמל / אנרגיה / סופת על
- לא טוב: בוץ + גשם -> סערת בוץ
- מצוין: בוץ + גשם -> שלולית / ביצה / טובעני

החזר אך ורק פורמט JSON נקי, ללא שום תגיות קוד (כמו \`\`\`json) וללא טקסט נוסף:

אם השילוב הצליח:
{
  "success": true,
  "name": "השם החדש (מילה אחת או ביטוי קצר ומקובל)",
  "emoji": "אימוג'י יחיד מתאים"
}

אם אין שילוב הגיוני מספיק:
{
  "success": false
}`;
}
export async function generate(
  itemA: string,
  itemB: string,
  existingListText: any,
  apiKey: string
): Promise<string> {
  const response = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        // model: "gpt-4.1-nano",
        model: "gpt-5-mini",
        // temperature: 0.9,
        // model: "gpt-4.1-mini",
        // temperature: 1.2,
        messages: [
          {
            role: "user",
            content: createPrompt(itemA, itemB, existingListText),
          },
        ],
        response_format: {
          type: "json_object",
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const data = await response.json();

  return data.choices?.[0]?.message?.content ?? "{}";
}