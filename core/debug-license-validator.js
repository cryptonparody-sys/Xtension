// DEBUG LICENSE VALIDATOR - Step by step debugging
class DebugLicenseValidator {
    constructor() {
        // Your public key (copy from Step 2 output)
        this.publicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtX4kO/ifItvCwVLIZ6mL
ciZYeM/UTwU4o+n5BK1UpraIh+IsrWXtVocVv/HKvHwXHxBzYjXGQG9nR3xrI8Jp
5I1J8E/a05LRrZuQJ+sWt1x1ShYpdYcJKnHfJoShuFLhzNTvK3e4YXYI6Q86C/jg
leEZLnBcesW9FjaR6T9TGHBE2V2V+ThKqb24qnfb4z6qbPTmZP3uBEkkwPfAPGWd
xLLilsZLpVpdmYmSsUf0vNXp7QmGadVpE30o/k1SMGlZW6jed9sKYSPEQNBXDzVB
02/sGkwIScHXWuYxFWjJCp33VaR0QCObcTRFbuwWnGI3Bxuj4Pt2cvnizwDqRkb2
MwIDAQAB
-----END PUBLIC KEY-----`;
    }

    async debugLicenseValidation(licenseKey) {
        console.log('🔍 DEBUGGING LICENSE VALIDATION');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('License Key:', licenseKey);
        console.log('License Key Length:', licenseKey.length);

        try {
            // Step 1: Parse license key
            const parts = licenseKey.split('-');
            console.log('\n📋 Step 1: Parsing License Key');
            console.log('Number of parts:', parts.length);
            console.log('Parts:', parts);

            if (parts.length !== 5 && parts.length !== 6) {
                throw new Error('Invalid license format - expected 5 or 6 parts, got ' + parts.length);
            }

            let prefix, duration, licenseId, encodedData, signature;
            let isTrial = false;

            if (parts.length === 6) {
                [prefix, trialMarker, duration, licenseId, encodedData, signature] = parts;
                if (trialMarker !== 'TRIAL') {
                    throw new Error('Invalid trial license format');
                }
                isTrial = true;
            } else {
                [prefix, duration, licenseId, encodedData, signature] = parts;
            }

            console.log('Prefix:', prefix);
            console.log('Duration:', duration);
            console.log('License ID:', licenseId);
            console.log('Encoded Data Length:', encodedData.length);
            console.log('Signature Length:', signature.length);

            // Step 2: Decode embedded data
            console.log('\n📄 Step 2: Decoding Embedded Data');
            let licenseData;
            try {
                const jsonString = atob(encodedData);
                console.log('Decoded JSON String Length:', jsonString.length);
                console.log('Decoded JSON String:', jsonString);
                licenseData = JSON.parse(jsonString);
                console.log('Parsed License Data:', JSON.stringify(licenseData, null, 2));
            } catch (error) {
                throw new Error('Failed to decode embedded license data: ' + error.message);
            }

            // Step 3: Verify license ID matches
            console.log('\n🔍 Step 3: Verifying License ID');
            console.log('License ID from key:', licenseId);
            console.log('License ID from data:', licenseData.id);
            if (licenseData.id !== licenseId) {
                throw new Error('License ID mismatch: ' + licenseData.id + ' != ' + licenseId);
            }
            console.log('✅ License ID matches');

            // Step 4: Check expiry
            console.log('\n⏰ Step 4: Checking Expiry');
            const expiryDate = new Date(licenseData.expires);
            const now = new Date();
            console.log('Current time:', now.toISOString());
            console.log('License expires:', expiryDate.toISOString());
            console.log('Is expired:', expiryDate < now);
            if (expiryDate < now) {
                throw new Error('License has expired');
            }
            console.log('✅ License not expired');

            // Step 5: Import public key
            console.log('\n🔐 Step 5: Importing Public Key');
            const publicKey = await this.debugImportPublicKey();
            console.log('✅ Public key imported successfully');

            // Step 6: Prepare data for verification
            console.log('\n📝 Step 6: Preparing Data for Verification');
            const dataString = JSON.stringify(licenseData);
            console.log('Data String to Verify:', '"' + dataString + '"');
            console.log('Data String Length:', dataString.length);

            const dataBuffer = new TextEncoder().encode(dataString);
            console.log('Data Buffer Length:', dataBuffer.length);

            // Step 7: Decode signature
            console.log('\n🔤 Step 7: Decoding Signature');
            console.log('Base64 Signature:', signature.substring(0, 50) + '...');
            const binaryString = atob(signature);
            console.log('Decoded Binary Length:', binaryString.length);

            const signatureBuffer = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                signatureBuffer[i] = binaryString.charCodeAt(i);
            }
            console.log('Signature Buffer Length:', signatureBuffer.length);

            // Step 8: Verify signature
            console.log('\n✅ Step 8: Verifying RSA Signature');
            console.log('Using algorithm: RSASSA-PKCS1-v1_5 with SHA-256');

            const isValid = await crypto.subtle.verify(
                'RSASSA-PKCS1-v1_5',
                publicKey,
                signatureBuffer,
                dataBuffer
            );

            console.log('🎯 VERIFICATION RESULT:', isValid);
            console.log('');

            if (!isValid) {
                throw new Error('Invalid license signature');
            }

            console.log('✅ License validation successful!');
            return licenseData;

        } catch (error) {
            console.error('❌ Validation failed:', error.message);
            console.error('Stack trace:', error.stack);
            return false;
        }
    }

    async debugImportPublicKey() {
        try {
            console.log('Public Key PEM:');
            console.log(this.publicKey);

            // Remove PEM headers and convert to buffer
            const pemHeader = "-----BEGIN PUBLIC KEY-----";
            const pemFooter = "-----END PUBLIC KEY-----";

            let pemContents = this.publicKey;

            // Remove all whitespace and newlines
            pemContents = pemContents.replace(/\s/g, '');
            console.log('Cleaned PEM length:', pemContents.length);

            // Remove headers
            pemContents = pemContents.replace(pemHeader, '');
            pemContents = pemContents.replace(pemFooter, '');
            console.log('Base64 content length:', pemContents.length);

            // Base64 decode the PEM contents
            const binaryDerString = atob(pemContents);
            console.log('Decoded DER length:', binaryDerString.length);

            const binaryDer = new Uint8Array(binaryDerString.length);
            for (let i = 0; i < binaryDerString.length; i++) {
                binaryDer[i] = binaryDerString.charCodeAt(i);
            }

            console.log('DER buffer first 16 bytes:', Array.from(binaryDer.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(''));

            // Import the key
            const publicKey = await crypto.subtle.importKey(
                "spki",
                binaryDer.buffer,
                {
                    name: "RSASSA-PKCS1-v1_5",
                    hash: "SHA-256"
                },
                false,
                ["verify"]
            );

            console.log('Key algorithm:', publicKey.algorithm);
            console.log('Key type:', publicKey.type);
            console.log('Key extractable:', publicKey.extractable);
            console.log('Key usages:', publicKey.usages);

            return publicKey;
        } catch (error) {
            console.error('Failed to import public key:', error);
            throw error;
        }
    }
}

// Export for ES modules
export { DebugLicenseValidator };

// Global instance for compatibility
window.DebugLicenseValidator = DebugLicenseValidator;