import { readFileSync, writeFileSync } from 'node:fs';

const buildGradlePath = process.argv[2] ?? 'android/app/build.gradle';
const gradlePropertiesPath = process.argv[3] ?? 'android/gradle.properties';
const source = readFileSync(buildGradlePath, 'utf8');
const gradleProperties = readFileSync(gradlePropertiesPath, 'utf8');

const debugSigningConfig = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;

const releaseSigningConfig = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            def keystorePath = System.getenv('ANDROID_KEYSTORE_PATH')
            def keystorePassword = System.getenv('ANDROID_KEYSTORE_PASSWORD')
            def releaseKeyAlias = System.getenv('ANDROID_KEY_ALIAS')
            def releaseKeyPassword = System.getenv('ANDROID_KEY_PASSWORD')

            if (!keystorePath || !keystorePassword || !releaseKeyAlias || !releaseKeyPassword) {
                throw new GradleException('Android release signing environment variables are incomplete.')
            }

            storeFile file(keystorePath)
            storePassword keystorePassword
            keyAlias releaseKeyAlias
            keyPassword releaseKeyPassword
        }
    }`;

const debugReleaseBinding = `        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

const signedReleaseBinding = `        release {
            signingConfig signingConfigs.release`;

const defaultJvmArgs = 'org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m';
const releaseJvmArgs = 'org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m';

if (
  !source.includes(debugSigningConfig) ||
  !source.includes(debugReleaseBinding) ||
  !gradleProperties.includes(defaultJvmArgs)
) {
  throw new Error(
    'Unable to configure the generated Android release project; the Expo native template has changed.',
  );
}

const configured = source
  .replace(debugSigningConfig, releaseSigningConfig)
  .replace(debugReleaseBinding, signedReleaseBinding);

writeFileSync(buildGradlePath, configured);
writeFileSync(gradlePropertiesPath, gradleProperties.replace(defaultJvmArgs, releaseJvmArgs));
