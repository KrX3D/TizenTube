/**
 * TizenTube Standalone YouTube TV Launcher
 * 
 * This launcher loads TizenTube user scripts globally, then launches
 * the native YouTube TV app. The scripts automatically inject themselves
 * into YouTube TV using the same JSON.parse hijacking approach.
 */

// AIDEV-NOTE: Core launcher class that coordinates script loading and YouTube TV launch
class YouTubeLauncher {
    constructor() {
        this.youtubeAppId = 'org.tizen.browser'; // Default Tizen browser for YouTube TV
        this.statusElement = document.getElementById('status');
        this.spinnerElement = document.getElementById('spinner');
        this.errorElement = document.getElementById('error');
        this.init();
    }
    
    async init() {
        try {
            this.updateStatus('Loading TizenTube modifications...');
            
            // Give time for userScript.js to fully initialize
            // AIDEV-NOTE: Critical timing - scripts must be loaded before YouTube launch
            await this.delay(3000);
            
            this.updateStatus('Launching enhanced YouTube TV...');
            await this.delay(1000);
            
            // Handle launch parameters if launched from external source (DIAL/cast)
            const launchParams = this.getLaunchParameters();
            if (launchParams) {
                console.log('TizenTube: Launch parameters detected', launchParams);
                this.launchYouTubeWithParams(launchParams);
            } else {
                this.launchYouTubeTV();
            }
            
        } catch (error) {
            this.showError('Failed to launch TizenTube: ' + error.message);
            console.error('TizenTube launcher error:', error);
        }
    }
    
    /**
     * Launch YouTube TV app with TizenTube modifications active
     */
    launchYouTubeTV(url = 'https://www.youtube.com/tv') {
        try {
            console.log('TizenTube: Launching YouTube TV with URL:', url);
            
            const appControl = new tizen.ApplicationControl(
                'http://tizen.org/appcontrol/operation/view',
                url
            );
            
            tizen.application.launchAppControl(
                appControl,
                null, // Launch any app that can handle YouTube TV
                () => {
                    console.log('TizenTube: YouTube TV launched successfully');
                    this.updateStatus('YouTube TV launched with TizenTube active!');
                    this.hideSpinner();
                    
                    // Hide launcher after successful launch
                    setTimeout(() => {
                        this.hideLauncher();
                    }, 2000);
                },
                (error) => {
                    console.error('TizenTube: Failed to launch YouTube TV:', error);
                    this.showError('Failed to launch YouTube TV. Is YouTube app installed?');
                }
            );
        } catch (error) {
            console.error('TizenTube: App launch error:', error);
            this.showError('App launch error: ' + error.message);
        }
    }
    
    /**
     * Handle launch with specific parameters (from DIAL casting)
     */
    launchYouTubeWithParams(params) {
        let url = 'https://www.youtube.com/tv';
        
        // Handle video ID parameter
        if (params.videoId || params.v) {
            const videoId = params.videoId || params.v;
            url += `?v=${videoId}`;
            console.log('TizenTube: Launching specific video:', videoId);
        }
        
        // Handle playlist parameter  
        if (params.listId || params.list) {
            const listId = params.listId || params.list;
            url += (url.includes('?') ? '&' : '?') + `list=${listId}`;
        }
        
        this.launchYouTubeTV(url);
    }
    
    /**
     * Extract launch parameters from Tizen application control
     */
    getLaunchParameters() {
        try {
            const appControl = tizen.application.getCurrentApplication().getRequestedAppControl();
            
            if (appControl && appControl.appControl && appControl.appControl.data) {
                const data = appControl.appControl.data;
                const params = {};
                
                for (let i = 0; i < data.length; i++) {
                    const key = data[i].key;
                    const values = data[i].value;
                    
                    if (key === 'PAYLOAD' && values.length > 0) {
                        // Parse DIAL payload
                        try {
                            const payload = JSON.parse(values[0]);
                            return payload;
                        } catch (e) {
                            console.warn('TizenTube: Failed to parse PAYLOAD:', e);
                        }
                    } else if (values.length > 0) {
                        params[key] = values[0];
                    }
                }
                
                return Object.keys(params).length > 0 ? params : null;
            }
        } catch (error) {
            console.log('TizenTube: No launch parameters detected');
        }
        
        return null;
    }
    
    /**
     * Update status message
     */
    updateStatus(message) {
        if (this.statusElement) {
            this.statusElement.textContent = message;
        }
        console.log('TizenTube Status:', message);
    }
    
    /**
     * Show error message
     */
    showError(message) {
        this.updateStatus('Error occurred');
        if (this.errorElement) {
            this.errorElement.textContent = message;
            this.errorElement.style.display = 'block';
        }
        this.hideSpinner();
        console.error('TizenTube Error:', message);
    }
    
    /**
     * Hide loading spinner
     */
    hideSpinner() {
        if (this.spinnerElement) {
            this.spinnerElement.style.display = 'none';
        }
    }
    
    /**
     * Hide the entire launcher interface
     */
    hideLauncher() {
        document.body.style.opacity = '0';
        setTimeout(() => {
            document.body.style.display = 'none';
        }, 500);
    }
    
    /**
     * Utility delay function
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// AIDEV-NOTE: Initialize launcher when DOM is ready
// Critical: Must run after userScript.js has loaded
window.addEventListener('load', () => {
    console.log('TizenTube: Starting launcher...');
    new YouTubeLauncher();
});

// AIDEV-NOTE: Global error handler for debugging
window.addEventListener('error', (event) => {
    console.error('TizenTube Global Error:', event.error);
});