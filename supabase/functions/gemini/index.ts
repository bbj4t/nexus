import { GoogleGenAI } from "https://esm.sh/@google/genai";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { model, contents, config, prompt } = await req.json();
    const apiKey = Deno.env.get('GEMINI_API_KEY');

    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set in Edge Secrets');
    }

    const genAI = new GoogleGenAI({ apiKey });

    // Support both simple 'prompt' and full 'contents'
    const finalContents = contents || [{ role: 'user', parts: [{ text: prompt }] }];
    const finalModel = model || 'gemini-2.5-flash-lite-latest';

    const response = await genAI.models.generateContent({
      model: finalModel,
      contents: finalContents,
      config: config
    });

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Gemini Function Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
