let offset = 0;
const batchSize = 10; // This will be dynamically set by the server
const articlesContainer = document.getElementById('articles-container');
const loadMoreButton = document.getElementById('load-more');
const endMessage = document.getElementById('end-message');
const loadingSpinner = document.getElementById('loading-spinner');
let isLoading = false;
let hasMore = true;

function createArticleElement(article) {
    const articleElement = document.createElement('div');
    articleElement.className = 'article';
    articleElement.dataset.guid = article.guid;

    // Image container
    const imageContainer = document.createElement('div');
    imageContainer.className = 'article-image-container';

    if (article.imageUrl) {
        const imageElement = document.createElement('img');
        imageElement.className = 'article-image';
        imageElement.alt = 'Article image';
        imageElement.src = article.imageUrl; // Set source - this triggers eager loading
        // Explicitly set loading attribute to 'eager'
        imageElement.loading = 'eager';
        // Optional: Add error handling
        imageElement.onerror = function() {
            console.warn('Image failed to load:', article.imageUrl);
            imageElement.style.display = 'none'; // Hide failed image
            const placeholder = document.createElement('div');
            placeholder.className = 'article-image-placeholder';
            placeholder.textContent = 'Image failed to load';
            imageContainer.replaceChild(placeholder, imageElement);
        };

        imageContainer.appendChild(imageElement);
    } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'article-image-placeholder';
        placeholder.textContent = 'No image';
        placeholder.style.backgroundColor = '#f9f9f9';
        placeholder.style.color = '#bbb';
        imageContainer.appendChild(placeholder);
    }

    // Title
    const titleElement = document.createElement('h2');
    titleElement.className = 'article-title';
    const titleLink = document.createElement('a');
    titleLink.href = article.link || '#';
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.textContent = article.title ? escapeHtml(article.title) : 'No title';
    
    // Add click handler to open in background tab
    titleLink.addEventListener('click', function(e) {
        if (article.link && article.link !== '#') {
            e.preventDefault();
            // Open in new tab without focusing (background tab)
            const newTab = window.open(article.link, '_blank', 'noopener,noreferrer');
            if (newTab) {
                newTab.blur();
                window.focus();
            }
        }
    });
    
    titleElement.appendChild(titleLink);

    // Meta (date) and Cached button container
    const metaElement = document.createElement('div');
    metaElement.className = 'article-meta';

    const dateSpan = document.createElement('span');
    dateSpan.textContent = article.pub_date ? new Date(article.pub_date).toLocaleString() : 'No date';
    metaElement.appendChild(dateSpan);

    // Add Cached button if full_text is available
    if (article.full_text && article.full_text.trim()) {
        const cachedButton = document.createElement('button');
        cachedButton.className = 'cached-button';
        cachedButton.textContent = 'Cached';
        cachedButton.title = 'View cached article content';

        cachedButton.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();

            // Open cached content in new tab
            const cachedUrl = `/api/cached/${encodeURIComponent(article.guid)}`;
            window.open(cachedUrl, '_blank', 'noopener,noreferrer');
        });

        metaElement.appendChild(cachedButton);
    }

    // Description
    const descElement = document.createElement('div');
    descElement.className = 'article-description';
    descElement.textContent = article.description ? truncateDescription(article.description, 300) : 'No description';

    // AI Summary (only if present)
    let aiSummaryElement = null;
    if (article.ai_sumamry && article.ai_sumamry.trim()) {
        aiSummaryElement = document.createElement('div');
        aiSummaryElement.className = 'article-ai-summary';
        aiSummaryElement.innerHTML = `<strong>🤖 AI Summary:</strong> ${escapeHtml(article.ai_sumamry)}`;
    }

    // Assemble article element
    articleElement.appendChild(imageContainer);
    articleElement.appendChild(titleElement);
    articleElement.appendChild(metaElement);
    articleElement.appendChild(descElement);
    
    // Add AI summary only if it exists
    if (aiSummaryElement) {
        articleElement.appendChild(aiSummaryElement);
    }

    return articleElement;
}

function truncateDescription(text, maxLength = 300) {
    if (!text) return '';
    let plainText = text.replace(/<[^>]*>/g, '');
    
    // Decode common HTML entities
    plainText = plainText
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&mdash;/g, '—')
        .replace(/&ndash;/g, '–')
        .replace(/&hellip;/g, '…')
        .replace(/&laquo;/g, '«')
        .replace(/&raquo;/g, '»');
        
    // Clean up multiple spaces
    plainText = plainText.replace(/\s+/g, ' ').trim();
    
    if (plainText.length <= maxLength) {
        return plainText;
    }
    return plainText.substring(0, maxLength) + '...';
}

async function loadArticles() {
    if (isLoading || !hasMore) return;
    isLoading = true;
    loadingSpinner.style.display = 'block';
    loadMoreButton.disabled = true;

    try {
        // Pass the *current* offset to the API, so it knows which batch was *just* viewed
        const response = await fetch(`/api/articles?offset=${offset}&limit=${batchSize}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const articles = await response.json();

        if (articles.length === 0) {
            hasMore = false;
            loadMoreButton.style.display = 'none';
            endMessage.style.display = 'block';
            
            // Mark any remaining batch as viewed when reaching end of feed
            await markFinalBatch();
            return;
        }

        const fragment = document.createDocumentFragment();

        articles.forEach(article => {
            const articleElement = createArticleElement(article);
            fragment.appendChild(articleElement);

            // --- REMOVED the separate /api/view call here ---
            // The marking now happens on the server side when fetching the *next* batch
        });

        articlesContainer.appendChild(fragment);

        offset += articles.length;

        if (articles.length < batchSize) {
            hasMore = false;
            loadMoreButton.style.display = 'none';
            if (articles.length > 0 || offset > 0) {
                endMessage.style.display = 'block';
                // Mark any remaining batch as viewed when reaching end of feed
                await markFinalBatch();
            }
        }
    } catch (error) {
        console.error('Error loading articles:', error);
        const errorElement = document.createElement('div');
        errorElement.className = 'article';
        errorElement.style.color = 'red';
        errorElement.textContent = 'Failed to load articles. Please try again later.';
        articlesContainer.appendChild(errorElement);
    } finally {
        isLoading = false;
        loadingSpinner.style.display = 'none';
        loadMoreButton.disabled = false;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "<")
        .replace(/>/g, ">")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function markFinalBatch() {
    try {
        const response = await fetch('/api/mark-final-batch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        if (response.ok) {
            console.log('Final batch marked as viewed');
        } else {
            console.warn('Failed to mark final batch as viewed');
        }
    } catch (error) {
        console.error('Error marking final batch:', error);
    }
}

// Initial load
loadArticles().then(() => {
    if (hasMore) {
        loadMoreButton.style.display = 'block';
    }
});

loadMoreButton.addEventListener('click', loadArticles);

// Infinite scroll with debounce - trigger when scrolled to the very end of the page
let scrollTimeout;
window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
        // Check if scrolled to the bottom of the page
        if (Math.ceil(window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight) {
            if (hasMore && !isLoading) {
                loadArticles();
            }
        }
    }, 100);
});