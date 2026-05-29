// Netlify Function: vimeo-videos
// Returns the complete video folder tree from the Coastguard Vimeo project
// Used by the frontend to dynamically render the video gallery
// Responses are cached for 5 minutes to reduce API calls

const ROOT_PROJECT_ID = '29249659'; // Coastguard 2026 LIBRARY SHOTS

function extractEmbedHash(embedHtml) {
  if (!embedHtml) return '';
  const match = embedHtml.match(/[?&]h=([a-f0-9]+)/);
  return match ? match[1] : '';
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins + ':' + (secs < 10 ? '0' : '') + secs;
}

function processVideo(videoData) {
  const videoId = videoData.uri.split('/').pop();
  
  // Find 640px wide thumbnail (good for grid display)
  const sizes = videoData.pictures?.sizes || [];
  const thumb = sizes.find(s => s.width === 640) || sizes[3] || sizes[sizes.length - 1];
  
  return {
    id: videoId,
    name: videoData.name,
    duration: videoData.duration,
    durationFormatted: formatDuration(videoData.duration),
    width: videoData.width,
    height: videoData.height,
    thumbnail: thumb?.link || '',
    embedHash: extractEmbedHash(videoData.embed?.html),
    isSquare: videoData.width === videoData.height
  };
}

async function getProjectItems(projectId, headers) {
  const url = `https://api.vimeo.com/me/projects/${projectId}/items?per_page=100`;
  const response = await fetch(url, { headers });
  
  if (!response.ok) {
    throw new Error(`Vimeo API error: ${response.status} for project ${projectId}`);
  }
  
  const data = await response.json();
  const videos = [];
  const folderPromises = [];

  for (const item of (data.data || [])) {
    if (item.type === 'video' && item.video) {
      videos.push(processVideo(item.video));
    } else if (item.type === 'folder' && item.folder) {
      const folderId = item.folder.uri.split('/').pop();
      const folderName = item.folder.name;
      
      // Fetch subfolder contents in parallel
      folderPromises.push(
        getProjectItems(folderId, headers).then(result => ({
          id: folderId,
          name: folderName,
          ...result
        }))
      );
    }
  }

  // Wait for all subfolder fetches to complete
  const folders = await Promise.all(folderPromises);
  
  return { videos, folders };
}

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

  const VIMEO_TOKEN = process.env.VIMEO_TOKEN;
  if (!VIMEO_TOKEN) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error: missing Vimeo token' })
    };
  }

  const headers = {
    'Authorization': `Bearer ${VIMEO_TOKEN}`,
    'Accept': 'application/vnd.vimeo.*+json;version=3.4'
  };

  try {
    const tree = await getProjectItems(ROOT_PROJECT_ID, headers);
    
    // Count total videos recursively
    function countVideos(node) {
      let count = node.videos ? node.videos.length : 0;
      if (node.folders) {
        for (const f of node.folders) {
          count += countVideos(f);
        }
      }
      return count;
    }
    
    const totalVideos = countVideos(tree);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
      },
      body: JSON.stringify({
        ...tree,
        totalVideos
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to fetch videos: ' + error.message })
    };
  }
};
