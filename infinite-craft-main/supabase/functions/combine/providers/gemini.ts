function createPrompt(itemA: string, itemB: string, existingListText: any): string {
    return `חשוב - שימוש חוזר באלמנטים קיימים:
אלה האלמנטים שכבר קיימים במשחק: ${existingListText}
אם התוצאה ההגיונית לשילוב הזה היא בעצם אחד מהאלמנטים הקיימים ברשימה (למשל אותו רעיון בניסוח שונה במקצת), החזר בדיוק את אותו שם קיים מהרשימה - אל תמציא שם כמעט-זהה חדש. רק אם באמת אין אלמנט קיים שמתאים, צור שם חדש.`
}

export async function generate(
  itemA: string,
  itemB: string,
  existingListText: any,
  apiKey: string
): Promise<string> {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: createPrompt(itemA, itemB, existingListText),
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const data = await response.json();

  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
}