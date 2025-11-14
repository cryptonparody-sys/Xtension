// 🌐 INTERNET-REQUIRED LICENSE VALIDATOR
// Server: http://77.90.51.74:3000
// Internet connection is MANDATORY for license activation
// NO offline fallback - server validation only

class XtensionLicenseValidator {
    constructor() {
        // Your public key (copy from public-key.pem)
        this.publicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2V7QhWlqvBbBdTnZc3h
VLCQdJh2YqJXhYF5hLHfJl4XrXqJhYF5hLHfJl4XrXqJhYF5hLHfJl4XrXqJhYF
5hLHfJl4XrXqJhYF5hLHfJl4XrXqJhYF5hLHfJl4XrXqJhYF5hLHfJl4XrXqJhYF
5hLHfJl4XrXqJhYF5hLHfJl4XrXqJhYF5hLHfJl4XrXqJhYF5hLHfJl4XrXqJhYF
5hLHfJl4XrXqJhYF5hLHfJl4XrXqJhYF5hLHfJl4XrXqJhYF5hLHfJl4XrXqJhYF
5hLHfJl4XrXqJhYF5hLHfJl4XrXqJhYF5hLHfJl4XrXqJhYF5hLHfJl4XrXqJhYF
5hLHfJl4XrXqJhYF5hLHfJl4XrXqJhYF5hLHfJl4XrXqJhYF5hLHfJl4XrXqJhYF
5hLHfJl4XrXqJhYF5hLHfJl4XrXqJhYF5hLHfJl4XrXqJhYF5hLHfJl4XrXqJhYF
QIDAQAB
-----END PUBLIC KEY-----`;

        this.serverUrl = 'http://77.90.51.74:3000';
        this.currentLicense = null;
        this.deviceId = null;
        this.validationStatus = 'pending';
        this.isValid = false;
        this.licenseInfo = null;
        this.internetRequired = true;
    }

    async initialize() {
        try {
            console.log('[XT License] Starting INTERNET-REQUIRED license validation...');

            // Generate unique device ID
            this.deviceId = await this.getDeviceId();
            if (this.deviceId) {
                console.log('[XT License] Device ID:', this.deviceId.substring(0, 8) + '...');
            } else {
                console.log('[XT License] Failed to generate device ID');
            }

            // Check for stored license
            const storedLicense = localStorage.getItem('xtensionLicense');
            if (storedLicense) {
                console.log('[XT License] Found stored license, validating with server...');
                const isValid = await this.validateLicense(storedLicense);
                if (isValid) {
                    this.validationStatus = 'valid';
                    this.isValid = true;
                    console.log('[XT License] ✅ Stored license is valid');
                } else {
                    console.log('[XT License] ❌ Stored license is invalid, removing...');
                    localStorage.removeItem('xtensionLicense');
                    this.validationStatus = 'invalid';
                    this.isValid = false;
                }
            } else {
                console.log('[XT License] No stored license found');
                this.validationStatus = 'none';
                this.isValid = false;
            }
        } catch (error) {
            console.error('[XT License] Initialization error:', error);
            this.validationStatus = 'error';
            this.isValid = false;
        }
    }

    // Generate device fingerprint
    async getDeviceId() {
        try {
            // Check if we're in a browser environment
            if (typeof navigator === 'undefined') {
                throw new Error('Navigator not available - not in a browser environment');
            }

            const components = {
                userAgent: navigator.userAgent || 'unknown',
                language: navigator.language || 'unknown',
                platform: navigator.platform || 'unknown',
                screenResolution: `${screen?.width || 0}x${screen?.height || 0}`,
                colorDepth: screen?.colorDepth || 24,
                timezone: typeof Intl !== 'undefined' && Intl.DateTimeFormat ?
                    Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
                timezoneOffset: new Date().getTimezoneOffset(),
                extensionId: typeof chrome !== 'undefined' && chrome?.runtime?.id || 'unknown-extension'
            };

            const fingerprintString = JSON.stringify(components, Object.keys(components).sort());
            const hashBuffer = await crypto.subtle.digest('SHA-256',
                new TextEncoder().encode(fingerprintString)
            );

            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (error) {
            console.error('[XT License] Error generating device ID:', error);
            return 'fallback-device-id-' + Math.random().toString(36).substr(2, 9);
        }
    }

    // Parse license key
    parseLicenseKey(licenseKey) {
        try {
            const parts = licenseKey.split('-');
            if (parts.length < 4) {
                throw new Error('Invalid license format');
            }

            const duration = parts[1];
            const licenseId = parts[2];
            const encodedData = parts[3];
            const signature = parts[4];

            // Decode license data
            const decodedData = JSON.parse(atob(encodedData));

            return {
                format: duration === 'TRIAL' ? 'trial' : 'standard',
                duration: duration === 'TRIAL' ? 'trial' : duration,
                licenseId: licenseId,
                data: decodedData,
                encodedData: encodedData,
                signature: signature
            };
        } catch (error) {
            throw new Error(`License parsing failed: ${error.message}`);
        }
    }

    // Verify RSA signature
    async verifySignature(data, signature) {
        try {
            const encoder = new TextEncoder();
            const dataBuffer = encoder.encode(data);
            const signatureBuffer = Uint8Array.from(atob(signature), c => c.charCodeAt(0));

            const publicKeyBuffer = await crypto.subtle.importKey(
                'spki',
                this.strToArrayBuffer(this.publicKey),
                { name: 'RSA-PSS', hash: 'SHA-256' },
                false,
                ['verify']
            );

            const isValid = await crypto.subtle.verify(
                {
                    name: 'RSA-PSS',
                    saltLength: 32
                },
                publicKeyBuffer,
                signatureBuffer,
                dataBuffer
            );

            return isValid;
        } catch (error) {
            console.error('[XT License] Signature verification error:', error);
            return false;
        }
    }

    strToArrayBuffer(str) {
        const bytes = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) {
            bytes[i] = str.charCodeAt(i);
        }
        return bytes.buffer;
    }

    // Test internet connection
    async testInternetConnection() {
        try {
            const response = await fetch(`${this.serverUrl}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(10000)
            });

            if (response.ok) {
                const health = await response.json();
                console.log('[XT License] ✅ Internet connection verified');
                return { connected: true, health };
            } else {
                return { connected: false, error: `Server error: ${response.status}` };
            }
        } catch (error) {
            console.log('[XT License] ❌ Internet connection failed:', error.message);
            return {
                connected: false,
                error: 'No internet connection or server unreachable',
                details: error.message
            };
        }
    }

    // Server validation (ONLY METHOD - NO OFFLINE FALLBACK)
    async validateWithServer(licenseKey) {
        try {
            console.log('[XT License] Validating with server (internet required)...');

            const response = await fetch(`${this.serverUrl}/api/licenses/validate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    licenseKey: licenseKey,
                    deviceId: this.deviceId,
                    deviceInfo: {
                        userAgent: navigator.userAgent,
                        platform: navigator.platform,
                        screenResolution: `${screen.width}x${screen.height}`,
                        timestamp: new Date().toISOString()
                    }
                }),
                signal: AbortSignal.timeout(15000)
            });

            if (!response.ok) {
                throw new Error(`Server error: ${response.status} ${response.statusText}`);
            }

            const result = await response.json();
            console.log('[XT License] Server response:', result);

            if (result.valid) {
                this.licenseInfo = result.licenseInfo;
                return {
                    valid: true,
                    reason: result.reason,
                    isNewActivation: result.isNewActivation,
                    licenseInfo: result.licenseInfo,
                    serverValidated: true
                };
            } else {
                return {
                    valid: false,
                    reason: result.reason,
                    serverBlocked: true
                };
            }

        } catch (error) {
            console.error('[XT License] Server validation failed:', error.message);

            // NO OFFLINE FALLBACK - Internet is mandatory
            if (error.name === 'AbortError') {
                throw new Error('Internet connection timeout - please check your connection');
            } else if (error.message.includes('Failed to fetch')) {
                throw new Error('No internet connection - license activation requires internet access');
            } else {
                throw new Error(`Server validation failed: ${error.message}`);
            }
        }
    }

    // Main validation function (SERVER ONLY)
    async validateLicense(licenseKey) {
        await this.initialize();

        try {
            // Test internet connection first
            const connectionTest = await this.testInternetConnection();
            if (!connectionTest.connected) {
                throw new Error('Internet connection required for license validation. Please check your connection and try again.');
            }

            // Server validation only
            const result = await this.validateWithServer(licenseKey);

            if (result.valid) {
                this.currentLicense = licenseKey;
                this.validationStatus = 'valid';
                this.isValid = true;
                return true;
            } else {
                this.validationStatus = 'invalid';
                this.isValid = false;
                return false;
            }

        } catch (error) {
            console.error('[XT License] Validation failed:', error.message);
            this.validationStatus = 'error';
            this.isValid = false;
            throw error; // Re-throw to show clear error message
        }
    }

    // Activate new license (internet required) - SENDS TO SERVER
    async activateLicense(licenseKey) {
        try {
            if (!licenseKey) {
                throw new Error('License key is required for activation');
            }

            if (!this.deviceId) {
                await this.initialize();
            }

            console.log('[XT License] 🚀 ACTIVATING LICENSE - Sending to server...');
            console.log('[XT License] 🔑 License Key:', licenseKey.substring(0, 30) + '...');
            console.log('[XT License] 📱 Device ID:', this.deviceId.substring(0, 16) + '...');

            // Test internet first
            const connectionTest = await this.testInternetConnection();
            if (!connectionTest.connected) {
                throw new Error('Internet connection required for license activation. Please check your connection and try again.');
            }

            // VALIDATE LICENSE BY SENDING TO SERVER
            // This checks if license is valid AND registers/binds it to this device
            const isValid = await this.validateLicense(licenseKey);

            if (isValid) {
                localStorage.setItem('xtensionLicense', licenseKey);
                this.currentLicense = licenseKey;
                console.log('[XT License] ✅ LICENSE ACTIVATED SUCCESSFULLY!');
                console.log('[XT License] 🔗 License is now bound to this device on the server');
                return true;
            } else {
                console.log('[XT License] ❌ License activation failed - server rejected');
                return false;
            }
        } catch (error) {
            console.error('[XT License] ❌ Activation error:', error.message);
            throw error; // Re-throw to show clear error message
        }
    }

    // Get license information
    getLicenseInfo() {
        return this.licenseInfo;
    }

    // Get remaining time
    getRemainingTime() {
        if (!this.licenseInfo) return null;

        const now = new Date();
        const expires = new Date(this.licenseInfo.expires);
        const diff = expires - now;

        if (diff <= 0) return null;

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

        if (days > 0) {
            return `${days}D ${hours}H`;
        } else {
            return `${hours}H`;
        }
    }

    // Check if license is trial
    isTrialLicense() {
        if (!this.licenseInfo) return false;
        return this.licenseInfo.duration === 0.02; // ~1 hour
    }

    // Get validation status
    getValidationStatus() {
        return {
            status: this.validationStatus,
            isValid: this.isValid,
            hasLicense: !!this.currentLicense,
            isServerValidated: this.validationStatus === 'valid',
            internetRequired: this.internetRequired,
            licenseInfo: this.licenseInfo,
            remainingTime: this.getRemainingTime(),
            isTrial: this.isTrialLicense()
        };
    }

    // Clear license
    clearLicense() {
        localStorage.removeItem('xtensionLicense');
        this.currentLicense = null;
        this.licenseInfo = null;
        this.validationStatus = 'none';
        this.isValid = false;
        console.log('[XT License] License cleared');
    }

    // Get user-friendly error messages
    getErrorMessage(error) {
        if (error.message.includes('Internet connection required')) {
            return '🌐 Internet connection required for license activation. Please connect to the internet and try again.';
        } else if (error.message.includes('License already used on maximum devices')) {
            return '🚫 This license is already activated on another device. Each license can only be used on 1 device.';
        } else if (error.message.includes('License not found')) {
            return '❌ Invalid license key. Please check your license and try again.';
        } else if (error.message.includes('License expired')) {
            return '⏰ This license has expired. Please contact support for renewal.';
        } else if (error.message.includes('timeout')) {
            return '⏱️ Connection timeout. Please check your internet connection and try again.';
        } else {
            return `❌ License validation failed: ${error.message}`;
        }
    }
}

// Export for use in extension
export { XtensionLicenseValidator };