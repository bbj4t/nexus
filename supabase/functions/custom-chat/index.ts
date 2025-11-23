import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const { messages, model, config } = await req.json();

        // Try CUSTOM_API_KEY first, then OPENROUTER_API_KEY
        const apiKey = Deno.env.get('CUSTOM_API_KEY') || Deno.env.get('OPENROUTER_API_KEY');
        const baseUrl = Deno.env.get('CUSTOM_BASE_URL') || 'https://openrouter.ai/api/v1';
        const defaultModel = Deno.env.get('CUSTOM_MODEL_NAME');

        if (!apiKey) {
            throw new Error('CUSTOM_API_KEY is not set in Edge Secrets');
        }

        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                // Some providers need extra headers, e.g. OpenRouter
                'HTTP-Referer': 'https://nexus-agent.com',
                'X-Title': 'Nexus Agent',
            },
            body: JSON.stringify({
                model: model || defaultModel,
                messages,
                ...config
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Provider Error (${response.status}): ${errText}`);
        }

        const data = await response.json();
        return new Response(
            JSON.stringify(data),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error("Custom Chat Function Error:", error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
