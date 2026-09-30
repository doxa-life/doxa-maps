// People Groups Store - Manages data from the Doxa prayer API
// Moved 2026-09-25 from the wall-of-people-groups no-build SPA: Pinia now comes from the package
// (it was the Pinia CDN global), localStorage keys carry a 'wall-pg:' prefix so an embedded wall
// cannot collide with the host page's own keys, and the source list is the one live API.
import { defineStore } from 'pinia'
import { applyPeopleGroupList } from '@map/lists/peopleGroupList.js'
const LS = (k) => 'wall-pg:' + k

export const usePeopleGroupsStore = (pinia) => {
    
    return defineStore('peopleGroups', {
        state: () => ({
            // The page's profile-config, set by the wall before it fetches: its people-group LIST.
            profileConfig: null,
            peopleGroups: [],
            loading: false,
            error: null,
            prayers: {}, // Track prayers per people group ID
            comments: {}, // Track comments per people group ID
            dataSource: 'PRAY_API', // 'PRAY_API', 'DOXA_API', or 'CSV'
            // The Doxa WordPress endpoint (uupg.doxa.life) no longer answers, and the CSV fallback was a
            // 2.6 MB copy of what the live API already serves, so neither ships.
            availableSources: [
                { id: 'PRAY_API', name: 'Prayer.Tools API (Live)', url: 'https://pray.doxa.life/api/people-groups/list', description: 'Live prayer data with images' }
            ]
        }),
        
        getters: {
            totalGroups: (state) => state.peopleGroups.length,
            
            getPrayerCount: (state) => (groupId) => {
                return state.prayers[groupId] || 0;
            },
            
            getComments: (state) => (groupId) => {
                return state.comments[groupId] || [];
            },
            
            currentSource: (state) => {
                return state.availableSources.find(s => s.id === state.dataSource);
            }
        },
        
        actions: {
            async fetchPeopleGroups() {
                this.loading = true;
                this.error = null;
                
                
                try {
                    if (this.dataSource === 'PRAY_API') {
                        await this.fetchFromPrayAPI();
                    } else if (this.dataSource === 'DOXA_API') {
                        await this.fetchFromAPI();
                    } else if (this.dataSource === 'CSV') {
                        await this.fetchFromCSV();
                    }
                    
                    
                } catch (error) {
                    // warn, not error: the wall now SAYS so on screen (PeopleGroupsWall's offline notice)
                    // and offers a retry; an unreachable API is an expected state, not a crash.
                    console.warn(`Could not fetch people groups from ${this.dataSource}:`, error && error.message);
                    this.error = error.message;
                    this.peopleGroups = [];
                } finally {
                    this.loading = false;
                }
            },
            
            async fetchFromPrayAPI() {
                const source = this.availableSources.find(s => s.id === 'PRAY_API');
                const apiUrl = source.url;
                
                const response = await fetch(apiUrl);
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                // Guard against HTML responses (bot protection, Nuxt SPA shell)
                const contentType = response.headers.get('content-type') || '';
                if (contentType.includes('text/html')) {
                    throw new Error('Server returned HTML instead of JSON — the API endpoint may be blocked or unavailable');
                }
                
                const data = await response.json();
                // Only the groups of this page's people-group LIST (library/lists/).
                const posts = await applyPeopleGroupList(data.posts && Array.isArray(data.posts) ? data.posts : (Array.isArray(data) ? data : []), this.profileConfig);
                
                if (posts.length === 0) {
                    console.error('Unexpected API response format:', data);
                    this.peopleGroups = [];
                    return;
                }
                
                // Placeholder for groups without photos
                const noPhotoPlaceholder = 'https://www.peoplegroups.org/images/pgphotosearch/NoImageAvailable_search.jpg';
                
                this.peopleGroups = posts.map(group => {
                    // Extract labels from nested value/label objects
                    const regionLabel = group.wagf_region?.label || group.wagf_region || '';
                    const blockLabel = group.wagf_block?.label || group.wagf_block || '';
                    const countryLabel = group.country_code?.label || group.country_code || '';
                    const countryCode = group.country_code?.value || group.country_code || '';
                    const religionLabel = group.religion?.label || group.religion || '';
                    const religionCode = group.religion?.value || '';
                    const affinityLabel = group.rop1?.label || '';
                    
                    // Image URL — API provides direct URLs, with regional fallbacks for no-photo groups
                    const hasPhoto = group.has_photo === true || group.has_photo === 'true' || group.has_photo === 1;
                    const imageUrl = group.image_url || noPhotoPlaceholder;
                    
                    return {
                        // Standard fields
                        ID: group.slug || `pray-${Math.random().toString(36).slice(2)}`,
                        post_title: group.name || 'Unknown',
                        name: group.name || 'Unknown',
                        slug: group.slug || '',
                        status: '',
                        country: countryLabel,
                        countryCode: countryCode,
                        region: regionLabel,
                        wagfBlock: blockLabel,
                        population: group.population || '',
                        religion: religionLabel,
                        religionCode: religionCode,
                        affinityBlock: affinityLabel,
                        latitude: group.latitude || null,
                        longitude: group.longitude || null,
                        description: group.location_description || '',
                        
                        // Prayer & engagement data (THE KEY FIELDS!)
                        peoplePraying: Number(group.people_praying || 0),
                        peopleCommitted: Number(group.people_committed || 0),
                        adoptedByChurches: Number(group.adopted_by_churches || 0),
                        
                        // Image fields
                        imageUrl: imageUrl,
                        hasPhoto: hasPhoto,
                        photoCredit: group.picture_credit || null,
                        imageStatus: hasPhoto ? 'pending' : 'placeholder',
                        
                        // Keep all original API data
                        ...group
                    };
                });
                
                // Log prayer & engagement statistics
                const withPrayer = this.peopleGroups.filter(g => g.peoplePraying > 0).length;
                const withCommitted = this.peopleGroups.filter(g => g.peopleCommitted > 0).length;
                const withAdoption = this.peopleGroups.filter(g => g.adoptedByChurches > 0).length;
                const withImages = this.peopleGroups.filter(g => g.hasPhoto).length;
                
                
                // Start background image testing
                this.testImagesInBackground();
            },
            
            async fetchFromAPI() {
                const source = this.availableSources.find(s => s.id === 'DOXA_API');
                const apiUrl = source.url;
                
                const response = await fetch(apiUrl);
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                // Guard against HTML responses (bot protection, error pages)
                const contentType = response.headers.get('content-type') || '';
                if (contentType.includes('text/html')) {
                    throw new Error('Server returned HTML instead of JSON — the API endpoint may be blocked or unavailable');
                }
                
                const data = await response.json();
                
                // Placeholder image for groups without photos
                const placeholderUrl = 'https://www.peoplegroups.org/images/pgphotosearch/NoImageAvailable_search.jpg';
                
                // The API returns { "posts": [...] }
                // Only the groups of this page's people-group LIST (library/lists/).
                const posts = await applyPeopleGroupList(data.posts && Array.isArray(data.posts) ? data.posts : (Array.isArray(data) ? data : []), this.profileConfig);
                
                if (posts.length === 0) {
                    console.error('Unexpected API response format:', data);
                    this.peopleGroups = [];
                    return;
                }
                
                this.peopleGroups = posts.map(group => {
                    // Determine image URL from API data
                    const hasPhoto = group.imb_has_photo === '1' || group.imb_has_photo === 1 || group.imb_has_photo === true;
                    const apiImageUrl = group.imb_picture_url || null;
                    const imageUrl = (hasPhoto && apiImageUrl) ? apiImageUrl : placeholderUrl;
                    
                    return {
                        // Standard fields mapped from API
                        ID: group.dt_id || group.ID || `api-${Math.random().toString(36).slice(2)}`,
                        post_title: group.imb_display_name || group.post_title || 'Unknown',
                        name: group.imb_display_name || group.post_title || 'Unknown',
                        slug: group.slug || '',
                        status: group.status || '',
                        country: group.imb_isoalpha3 || '',
                        region: group.doxa_wagf_region || '',
                        wagfBlock: group.doxa_wagf_block || '',
                        population: group.imb_population || '',
                        religion: group.imb_reg_of_religion || '',
                        religionCode: group.imb_reg_of_religion_3 || '',
                        latitude: group.imb_lat || null,
                        longitude: group.imb_lng || null,
                        description: group.imb_people_description || '',
                        
                        // Image fields
                        imageUrl: imageUrl,
                        hasPhoto: hasPhoto,
                        photoCredit: group.imb_picture_credit_html || '',
                        imageStatus: hasPhoto && apiImageUrl ? 'pending' : 'placeholder',
                        
                        // Keep all original API data
                        ...group
                    };
                });
                
                // Log image statistics
                const withImages = this.peopleGroups.filter(g => g.hasPhoto && g.imb_picture_url).length;
                const withPlaceholder = this.peopleGroups.length - withImages;
                
                // Start background image testing for groups that have URLs
                this.testImagesInBackground();
            },
            
            async fetchFromCSV() {
                const source = this.availableSources.find(s => s.id === 'CSV');
                const csvUrl = source.url;
                
                const response = await fetch(csvUrl);
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const csvText = await response.text();
                const parsedData = this.parseCSV(csvText);
                
                // Map all groups to standard format
                const allGroups = parsedData.map(group => ({
                    ID: group.PEID || group.PeopleID3 || `csv-${Math.random()}`,
                    post_title: group.Name || group.PplNm,
                    name: group.Name || group.PplNm,
                    status: group.Status || 'Active',
                    country: group.Ctry,
                    region: group.Regn,
                    population: group.Pop,
                    language: group.Lang,
                    religion: group.Rlgn,
                    peopleID3: group.PeopleID3 && group.PeopleID3.trim() !== '' ? group.PeopleID3.trim() : null,
                    imageUrl: group.PeopleID3 && group.PeopleID3.trim() !== '' ? this.generateImageUrl(group.PeopleID3.trim()) : null,
                    imageStatus: 'pending', // 'pending', 'loading', 'loaded', 'failed', 'error'
                    // Include all original CSV data
                    ...group
                }));
                
                // Count cluster statistics
                const clusterStats = {};
                allGroups.forEach(group => {
                    if (group.peopleID3) {
                        if (!clusterStats[group.peopleID3]) {
                            clusterStats[group.peopleID3] = { total: 0 };
                        }
                        clusterStats[group.peopleID3].total++;
                    }
                });
                
                // Initial sort by cluster size
                this.peopleGroups = allGroups.sort((a, b) => {
                    const aHasID = a.peopleID3 ? 1 : 0;
                    const bHasID = b.peopleID3 ? 1 : 0;
                    
                    // Groups with PeopleID3 come before groups without
                    if (aHasID !== bHasID) {
                        return bHasID - aHasID;
                    }
                    
                    // Both have PeopleID3: sort by cluster size
                    if (aHasID && bHasID) {
                        const aCluster = clusterStats[a.peopleID3];
                        const bCluster = clusterStats[b.peopleID3];
                        
                        if (aCluster.total !== bCluster.total) {
                            return bCluster.total - aCluster.total;
                        }
                        
                        return a.peopleID3.localeCompare(b.peopleID3);
                    }
                    
                    return 0;
                });
                
                const withPeopleID3 = this.peopleGroups.filter(g => g.peopleID3).length;
                const withoutPeopleID3 = this.peopleGroups.length - withPeopleID3;
                const uniqueClusters = Object.keys(clusterStats).length;
                
                
                // Start background image testing (non-blocking)
                this.testImagesInBackground();
            },
            
            async testImagesInBackground() {
                
                // Get groups that need image testing (have a real imageUrl, not placeholder)
                const groupsToTest = this.peopleGroups.filter(g => 
                    g.imageUrl && g.imageStatus === 'pending'
                );
                
                // Deduplicate by imageUrl
                const uniqueTests = new Map();
                groupsToTest.forEach(group => {
                    if (!uniqueTests.has(group.imageUrl)) {
                        uniqueTests.set(group.imageUrl, {
                            url: group.imageUrl,
                            groupIds: [group.ID],
                            status: 'pending'
                        });
                    } else {
                        uniqueTests.get(group.imageUrl).groupIds.push(group.ID);
                    }
                });
                
                const totalToTest = uniqueTests.size;
                let tested = 0;
                let loaded = 0;
                let failed = 0;
                let errors = 0;
                
                
                // Test images SLOWLY - only 3 at a time with delays
                const batchSize = 3; // Small batch size to avoid rate limiting
                const delayBetweenBatches = 1000; // 1 second delay between batches
                const maxRetries = 3; // Retry failed images up to 3 times
                
                const entries = Array.from(uniqueTests.entries());
                
                const placeholderUrl = 'https://www.peoplegroups.org/images/pgphotosearch/NoImageAvailable_search.jpg';
                
                for (let i = 0; i < entries.length; i += batchSize) {
                    const batch = entries.slice(i, i + batchSize);
                    const promises = batch.map(([imageUrl, info]) => 
                        this.testImageWithRetry(info.url, null, maxRetries).then(result => ({
                            imageUrl,
                            groupIds: info.groupIds,
                            ...result
                        }))
                    );
                    
                    const results = await Promise.all(promises);
                    
                    // Update groups with results
                    results.forEach(result => {
                        const { groupIds, status, attempts } = result;
                        
                        this.peopleGroups.forEach(group => {
                            if (groupIds.includes(group.ID)) {
                                group.imageStatus = status;
                                group.imageAttempts = attempts;
                                if (status === 'failed' || status === 'error') {
                                    // Fall back to placeholder
                                    group.imageUrl = placeholderUrl;
                                    group.imageStatus = 'placeholder';
                                }
                            }
                        });
                        
                        tested++;
                        if (status === 'loaded') {
                            loaded++;
                        } else if (status === 'failed') {
                            failed++;
                            console.warn(`   ❌ 404: ${result.imageUrl} (tried ${attempts} times)`);
                        } else if (status === 'error') {
                            errors++;
                            console.error(`   ⚠️ Error: ${result.imageUrl} (tried ${attempts} times)`);
                        }
                    });
                    
                    // Log progress every 10 batches
                    if ((i / batchSize) % 10 === 0) {
                    }
                    
                    // Delay between batches to avoid rate limiting
                    if (i + batchSize < entries.length) {
                        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
                    }
                }
                
            },
            
            async testImageWithRetry(url, peopleID3, maxRetries = 3) {
                let lastResult = null;
                
                // First, try the primary URL (media.joshuaproject.net with /public/)
                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                    const result = await this.testImageLoadDetailed(url);
                    
                    // If loaded successfully, return immediately
                    if (result.status === 'loaded') {
                        return { ...result, attempts: attempt, urlFormat: 'primary' };
                    }
                    
                    lastResult = result;
                    
                    if (attempt < maxRetries) {
                        // Wait before retrying (exponential backoff)
                        const delay = 500 * attempt; // 500ms, 1000ms, 1500ms...
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
                
                // Primary URL failed, try fallback URL format
                const fallbackUrl = `https://joshuaproject.net/assets/media/profiles/photos/p${peopleID3}.jpg`;
                
                const fallbackResult = await this.testImageLoadDetailed(fallbackUrl);
                
                if (fallbackResult.status === 'loaded') {
                    // Update the group's imageUrl to use the fallback
                    this.peopleGroups.forEach(group => {
                        if (group.peopleID3 === peopleID3) {
                            group.imageUrl = fallbackUrl;
                        }
                    });
                    return { ...fallbackResult, attempts: maxRetries + 1, urlFormat: 'fallback' };
                }
                
                // Both primary and fallback failed
                return { ...lastResult, attempts: maxRetries + 1, urlFormat: 'none' };
            },
            
            testImageLoadDetailed(url) {
                return new Promise((resolve) => {
                    const img = new Image();
                    const timeout = setTimeout(() => {
                        img.src = ''; // Cancel loading
                        resolve({ status: 'error', statusCode: 'timeout', url });
                    }, 10000); // 10 second timeout (longer for slow networks)
                    
                    img.onload = () => {
                        clearTimeout(timeout);
                        resolve({ status: 'loaded', statusCode: 200, url });
                    };
                    
                    img.onerror = () => {
                        clearTimeout(timeout);
                        // Assume failed (could be 404 or network error)
                        resolve({ status: 'failed', statusCode: 404, url });
                    };
                    
                    img.src = url;
                });
            },
            
            parseCSV(csvText) {
                // Split by newline but handle quoted fields with embedded newlines
                const lines = [];
                let currentLine = '';
                let inQuotes = false;
                
                for (let i = 0; i < csvText.length; i++) {
                    const char = csvText[i];
                    
                    if (char === '"') {
                        inQuotes = !inQuotes;
                        currentLine += char;
                    } else if (char === '\n' && !inQuotes) {
                        if (currentLine.trim()) {
                            lines.push(currentLine);
                        }
                        currentLine = '';
                    } else {
                        currentLine += char;
                    }
                }
                
                // Add last line if exists
                if (currentLine.trim()) {
                    lines.push(currentLine);
                }
                
                if (lines.length === 0) return [];
                
                // Get headers from first line - parse CSV properly
                const headers = this.parseCSVLine(lines[0]);
                
                const data = [];
                
                // Parse each line
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    
                    const values = this.parseCSVLine(line);
                    
                    const row = {};
                    headers.forEach((header, index) => {
                        if (values[index] !== undefined) {
                            row[header] = values[index];
                        }
                    });
                    
                    data.push(row);
                }
                
                return data;
            },
            
            parseCSVLine(line) {
                const result = [];
                let current = '';
                let inQuotes = false;
                
                for (let i = 0; i < line.length; i++) {
                    const char = line[i];
                    
                    if (char === '"') {
                        inQuotes = !inQuotes;
                    } else if (char === ',' && !inQuotes) {
                        result.push(current.trim());
                        current = '';
                    } else {
                        current += char;
                    }
                }
                
                // Add last field
                result.push(current.trim());
                
                return result;
            },
            
            generateImageUrl(peopleID3) {
                if (!peopleID3 || peopleID3.trim() === '') {
                    return null;
                }
                
                // Primary URL format (works better): https://media.joshuaproject.net/public/assets/media/profiles/photos/p19007.jpg
                // Fallback URL format: https://joshuaproject.net/assets/media/profiles/photos/p18194.jpg
                return `https://media.joshuaproject.net/public/assets/media/profiles/photos/p${peopleID3}.jpg`;
            },
            
            setDataSource(sourceId) {
                if (this.dataSource !== sourceId) {
                    this.dataSource = sourceId;
                    // Save preference to localStorage
                    localStorage.setItem(LS('dataSource'), sourceId);
                    // Refetch data from new source
                    this.fetchPeopleGroups();
                }
            },
            
            addPrayer(groupId) {
                if (!this.prayers[groupId]) {
                    this.prayers[groupId] = 0;
                }
                this.prayers[groupId]++;
                
                // Save to localStorage for persistence
                localStorage.setItem(LS('prayers'), JSON.stringify(this.prayers));
            },
            
            addComment(groupId, comment) {
                if (!this.comments[groupId]) {
                    this.comments[groupId] = [];
                }
                
                this.comments[groupId].push({
                    id: Date.now(),
                    text: comment,
                    timestamp: new Date().toISOString()
                });
                
                // Save to localStorage for persistence
                localStorage.setItem(LS('comments'), JSON.stringify(this.comments));
            },
            
            loadFromLocalStorage() {
                try {
                    const savedPrayers = localStorage.getItem(LS('prayers'));
                    const savedComments = localStorage.getItem(LS('comments'));
                    const savedSource = localStorage.getItem(LS('dataSource'));
                    
                    if (savedPrayers) {
                        this.prayers = JSON.parse(savedPrayers);
                    }
                    
                    if (savedComments) {
                        this.comments = JSON.parse(savedComments);
                    }
                    
                    if (savedSource && ['PRAY_API'].includes(savedSource)) {
                        this.dataSource = savedSource;
                    }
                } catch (error) {
                    console.error('Error loading from localStorage:', error);
                }
            }
        }
    })(pinia);
};



