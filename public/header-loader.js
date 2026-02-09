// Unified Header Loader v2 - Loads header component and executes its scripts
console.log('🔄 Header loader starting...');
(function() {
    const headerContainer = document.getElementById('header-container');
    if (!headerContainer) {
        console.error('❌ header-container element not found!');
        return;
    }
    
    console.log('📥 Fetching header component...');
    fetch('/business-manager/public/components/header.html?v=' + Date.now())
        .then(r => {
            if (!r.ok) throw new Error('Header load failed: ' + r.status);
            return r.text();
        })
        .then(html => {
            // Create temporary container
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            
            // Extract script content
            const scripts = tempDiv.querySelectorAll('script');
            const scriptContent = Array.from(scripts).map(s => s.textContent).join('\n');
            
            // Remove script tags from HTML
            scripts.forEach(s => s.remove());
            
            // Insert HTML
            const container = document.getElementById('header-container');
            if (container) {
                container.innerHTML = tempDiv.innerHTML;
                
                // Execute scripts in global scope
                const scriptTag = document.createElement('script');
                scriptTag.textContent = scriptContent;
                document.body.appendChild(scriptTag);
                
                console.log('✅ Header loaded successfully');
                console.log('📊 Header HTML length:', tempDiv.innerHTML.length);
                console.log('📜 Scripts found:', scripts.length);
            } else {
                console.error('❌ header-container not found in DOM');
            }
        })
        .catch(err => {
            console.error('Failed to load header:', err);
            const container = document.getElementById('header-container');
            if (container) {
                container.innerHTML = `
                    <div style="background: #ef4444; padding: 1rem; color: white; text-align: center;">
                        ⚠️ Header failed to load. Please refresh the page.
                    </div>
                `;
            }
        });
})();
