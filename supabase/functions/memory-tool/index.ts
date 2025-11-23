import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenAI } from 'https://esm.sh/@google/genai';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const { action, apiKey, content, query } = await req.json();

        // Initialize Supabase Client
        // We use the Authorization header from the client which contains the Supabase Key
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            throw new Error('Missing Authorization header');
        }

        // Standard Supabase Edge Function Env Vars
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

        const supabase = createClient(
            supabaseUrl,
            supabaseAnonKey,
            { global: { headers: { Authorization: authHeader } } }
        );

        // Initialize Gemini
        let genAI;
        if (apiKey) {
            genAI = new GoogleGenAI({ apiKey });
        } else if (action === 'save' || action === 'query') {
            throw new Error('Missing Gemini API Key');
        }

        if (action === 'save') {
            if (!content) throw new Error('Missing content');

            // Generate embedding
            const embeddingResp = await genAI.models.embedContent({
                model: 'text-embedding-004',
                content: content,
            });
            const embedding = embeddingResp.embedding.values;

            const { error } = await supabase.from('memories').insert({
                content,
                embedding
            });

            if (error) throw error;

            return new Response(JSON.stringify({ ok: true }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        if (action === 'query') {
            if (!query) throw new Error('Missing query');

            const embeddingResp = await genAI.models.embedContent({
                model: 'text-embedding-004',
                content: query,
            });
            const embedding = embeddingResp.embedding.values;

            const { data, error } = await supabase.rpc('match_memories', {
                query_embedding: embedding,
                match_threshold: 0.5,
                match_count: 5
            });

            if (error) throw error;

            return new Response(JSON.stringify({ documents: data }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        if (action === 'get_recent') {
            const { data, error } = await supabase
                .from('memories')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(10);

            if (error) throw error;

            return new Response(JSON.stringify({ memories: data }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        throw new Error(`Unknown action: ${action}`);

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
