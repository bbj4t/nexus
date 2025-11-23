/**
 * Helper to sanitize and format the Edge Function URL
 */
export const getFunctionUrl = (baseUrl: string, functionName: string) => {
    if (!baseUrl) return '';
    let url = baseUrl.trim();

    // Remove trailing slashes
    while (url.endsWith('/')) {
        url = url.slice(0, -1);
    }

    // Ensure protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
    }

    // If the user mistakenly pasted the full function path (detected by presence of /functions/v1)
    // we trust their input but ensure we point to the correct function.
    if (url.includes('/functions/v1')) {
        // If they pasted the exact function URL, return it (assuming it matches)
        if (url.endsWith(`/${functionName}`)) return url;

        // If they just pasted .../functions/v1, append the function name
        if (url.endsWith('/functions/v1')) return `${url}/${functionName}`;

        // Otherwise, just return what they gave + function name if missing? 
        // Safest is to strip back to base if possible, but for now let's assume standard project URL is best.
        return url;
    }

    // Standard project URL case: https://project-ref.supabase.co
    return `${url}/functions/v1/${functionName}`;
};
