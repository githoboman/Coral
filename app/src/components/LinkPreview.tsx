import { useState, useEffect } from 'react';
import { ExternalLink } from 'lucide-react';

interface LinkPreviewProps {
  url: string;
}

interface OGMetadata {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  siteName?: string;
}

// Fetch URL metadata using AllOrigins CORS proxy
async function fetchUrlPreview(url: string): Promise<OGMetadata | null> {
  try {
    const response = await fetch(
      `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`
    );
    const data = await response.json();
    const html = data.contents;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const getMetaContent = (property: string) => {
      const meta =
        doc.querySelector(`meta[property="${property}"]`) ||
        doc.querySelector(`meta[name="${property}"]`);
      return meta?.getAttribute('content') || '';
    };

    const title =
      getMetaContent('og:title') ||
      doc.querySelector('title')?.textContent ||
      '';

    const description =
      getMetaContent('og:description') ||
      getMetaContent('description') ||
      '';

    const image = getMetaContent('og:image') || '';
    const siteName = getMetaContent('og:site_name') || new URL(url).hostname;

    return {
      url,
      title: title.slice(0, 100),
      description: description.slice(0, 200),
      image,
      siteName,
    };
  } catch (error) {
    console.error('Error fetching URL preview:', error);
    try {
      const urlObj = new URL(url);
      return {
        url,
        title: urlObj.hostname,
        description: url,
        siteName: urlObj.hostname,
      };
    } catch {
      return null;
    }
  }
}

export default function LinkPreview({ url }: LinkPreviewProps) {
  const [metadata, setMetadata] = useState<OGMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    const loadPreview = async () => {
      try {
        const preview = await fetchUrlPreview(url);
        if (preview) {
          setMetadata(preview);
        } else {
          setError(true);
        }
      } catch (err) {
        console.error('Link preview error:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    loadPreview();
  }, [url]);

  if (loading) {
    return (
      <div className="mt-3 p-4 rounded-xl bg-white/5 border border-white/10 animate-pulse">
        <div className="h-4 bg-white/10 rounded w-3/4 mb-2"></div>
        <div className="h-3 bg-white/10 rounded w-1/2"></div>
      </div>
    );
  }

  if (error || !metadata || !metadata.title) {
    return null;
  }

  const displayUrl = new URL(url).hostname.replace('www.', '');

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 block group"
    >
      <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden transition-all hover:bg-white/10 hover:border-white/20">
        <div className="flex flex-col-reverse md:flex-row gap-3 p-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white mb-1 line-clamp-2 group-hover:text-emerald-400 transition-colors">
              {metadata.title}
            </h3>
            {metadata.description && (
              <p className="text-xs text-white/60 line-clamp-2 mb-2">
                {metadata.description}
              </p>
            )}
            <div className="flex items-center gap-2 text-xs text-white/40">
              <ExternalLink size={12} />
              <span>{metadata.siteName || displayUrl}</span>
            </div>
          </div>

          {metadata.image && !imageError && (
            <div className="flex-shrink-0">
              <img
                src={metadata.image}
                alt=""
                className="w-full md:w-24 md:h-24 object-cover rounded"
                onError={() => setImageError(true)}
              />
            </div>
          )}
        </div>
      </div>
    </a>
  );
}
