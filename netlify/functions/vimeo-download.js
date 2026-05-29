// Netlify Function: vimeo-download
// Fetches a fresh download URL from Vimeo and redirects to it
// Usage: /.netlify/functions/vimeo-download?id=VIDEO_ID
// Optional: &format=json (returns URL as JSON instead of redirect)
// Optional: &quality=1080 (preferred height, defaults to 1080)

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      }
    };
  }

  const videoId = event.queryStringParameters?.id;
  if (!videoId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing video ID parameter' })
    };
  }

  // Validate video ID format (numeric only)
  if (!/^\d+$/.test(videoId)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid video ID format' })
    };
  }

  const VIMEO_TOKEN = process.env.VIMEO_TOKEN;
  if (!VIMEO_TOKEN) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error: missing Vimeo token' })
    };
  }

  try {
    const response = await fetch(
      `https://api.vimeo.com/videos/${videoId}?fields=download,name`,
      {
        headers: {
          'Authorization': `Bearer ${VIMEO_TOKEN}`,
          'Accept': 'application/vnd.vimeo.*+json;version=3.4'
        }
      }
    );

    if (!response.ok) {
      return {
        statusCode: response.status === 404 ? 404 : 502,
        body: JSON.stringify({ error: 'Could not fetch video from Vimeo' })
      };
    }

    const data = await response.json();
    const downloads = data.download || [];

    if (downloads.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'No downloads available for this video' })
      };
    }

    // Find preferred quality
    const preferredHeight = parseInt(event.queryStringParameters?.quality || '1080', 10);
    
    // Sort by height descending
    const sorted = [...downloads].sort((a, b) => (b.height || 0) - (a.height || 0));
    
    // Find exact match or closest without exceeding preferred
    let best = sorted.find(d => d.height === preferredHeight);
    if (!best) {
      // Find highest quality at or below preferred height
      best = sorted.find(d => d.height <= preferredHeight);
    }
    if (!best) {
      // Fall back to lowest available
      best = sorted[sorted.length - 1];
    }

    // JSON format returns the URL for client-side download (used by ZIP feature)
    const format = event.queryStringParameters?.format;
    if (format === 'json') {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          url: best.link,
          name: data.name,
          size: best.size,
          quality: best.quality,
          width: best.width,
          height: best.height
        })
      };
    }

    // Default: redirect to download URL
    return {
      statusCode: 302,
      headers: {
        'Location': best.link
      }
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error: ' + error.message })
    };
  }
};
