import { useEffect, useRef, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Camera, Image as ImageIcon, LockKeyhole, Pencil, ShieldCheck } from 'lucide-react-native';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Banner, Body, Button, Screen } from '@/components/ui';
import { effectiveGroupType } from '@/domain/groups';
import { groupContextLabel } from '@/features/groups/group-type-ui';
import { cleanReceiptCache, deleteCapturedReceipt, deletePreparedReceipt, prepareReceiptImage } from '@/features/receipt-scanning/prepare-receipt-image';
import { ReceiptOcrError, receiptOcr } from '@/features/receipt-scanning/receipt-ocr';
import { useReceiptDraft } from '@/features/receipt-scanning/receipt-draft-provider';
import { receiptProfileDefinitionFor } from '@/features/receipt-scanning/receipt-profile-registry';
import type { CapturedReceiptImage, ReceiptOcrStatus } from '@/features/receipt-scanning/receipt-types';
import { useGroup } from '@/providers/group-provider';
import { useSession } from '@/providers/session-provider';
import { useTheme } from '@/providers/theme-provider';

type Phase = 'capture' | 'preview' | 'preparing' | 'reading';

export default function ScanReceiptScreen() {
  const router = useRouter();
  const { owner, repo } = useLocalSearchParams<{ owner: string; repo: string }>();
  const { colors } = useTheme();
  const { state } = useGroup();
  const { session } = useSession();
  const { setReceiptDraft } = useReceiptDraft();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const requestId = useRef<string | null>(null);
  const preparedUri = useRef<string | null>(null);
  const imageRef = useRef<CapturedReceiptImage | null>(null);
  const [image, setImage] = useState<CapturedReceiptImage | null>(null);
  const [phase, setPhase] = useState<Phase>('capture');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ReceiptOcrStatus | null>(null);
  const currency = state.data?.group.currency;
  const groupType = state.data ? effectiveGroupType(state.data.group) : null;
  const profileDefinition = groupType ? receiptProfileDefinitionFor(groupType) : null;
  const profile = profileDefinition?.id;

  useEffect(() => {
    void cleanReceiptCache().catch(() => undefined);
    if (profile) void receiptOcr.getStatus(profile).then(setStatus).catch((cause) => setError(cause instanceof Error ? cause.message : 'Receipt scanning is unavailable.'));
    return () => {
      if (requestId.current) void receiptOcr.cancel(requestId.current);
      deletePreparedReceipt(preparedUri.current);
      deleteCapturedReceipt(imageRef.current);
    };
  }, [profile]);

  const openManualEntry = () => {
    deletePreparedReceipt(preparedUri.current);
    deleteCapturedReceipt(imageRef.current);
    router.replace({ pathname: '/groups/[owner]/[repo]/expenses/new', params: { owner, repo } } as never);
  };

  const showCapturedImage = (next: CapturedReceiptImage) => {
    setError(null);
    imageRef.current = next;
    setImage(next);
    setPhase('preview');
  };

  const takePhoto = async () => {
    if (!cameraRef.current) return;
    setError(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.95, skipProcessing: false });
      if (photo) showCapturedImage({ uri: photo.uri, width: photo.width, height: photo.height, ownership: 'app_cache' });
    } catch {
      setError('The camera could not take a photo. Try again or choose one from Photos.');
    }
  };

  const choosePhoto = async () => {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1 });
    if (!result.canceled) {
      const asset = result.assets[0];
      if (asset) showCapturedImage({ uri: asset.uri, width: asset.width, height: asset.height, ownership: 'external_original' });
    }
  };

  const retake = () => {
    deletePreparedReceipt(preparedUri.current);
    deleteCapturedReceipt(imageRef.current);
    preparedUri.current = null;
    imageRef.current = null;
    setImage(null);
    setError(null);
    setPhase('capture');
  };

  const readReceipt = async () => {
    if (!image || !currency || !profile || !profileDefinition || !state.data || !groupType || !session.account) return;
    setError(null);
    try {
      const currentStatus = await receiptOcr.getStatus(profile);
      setStatus(currentStatus);
      if (currentStatus.state !== 'ready' || !currentStatus.modelBundleVersion || !currentStatus.profileVersion) throw new ReceiptOcrError(currentStatus.state, currentStatus.safeMessage);
      setPhase('preparing');
      const prepared = await prepareReceiptImage(image);
      preparedUri.current = prepared.uri;
      setPhase('reading');
      const id = Crypto.randomUUID();
      requestId.current = id;
      const result = await receiptOcr.recognize(id, prepared.uri, profile);
      requestId.current = null;
      const draft = profileDefinition.parse(result, currency, currentStatus.modelBundleVersion, currentStatus.profileVersion);
      setReceiptDraft(draft, { accountId: session.account.id, groupKey: state.data.key, groupType, attemptId: id });
      deletePreparedReceipt(prepared.uri);
      deleteCapturedReceipt(imageRef.current);
      preparedUri.current = null;
      imageRef.current = null;
      router.replace({ pathname: '/groups/[owner]/[repo]/expenses/new', params: { owner, repo } } as never);
    } catch (cause) {
      requestId.current = null;
      setPhase('preview');
      setError(cause instanceof Error ? cause.message : 'The receipt could not be read on this device.');
    }
  };

  const processing = phase === 'preparing' || phase === 'reading';
  const moduleUnavailable = status && status.state !== 'ready';
  return <Screen scroll={false} safeAreaEdges={['left', 'right', 'bottom']} contentStyle={styles.screen}>
    <Text style={[styles.groupContext, { color: colors.accent }]}>{state.data && groupType ? groupContextLabel(groupType, state.data.group.name).toUpperCase() : (state.data?.group.name ?? 'BranchBalance').toUpperCase()}</Text>
    <View style={styles.localStatus}><View style={[styles.pill, { backgroundColor: colors.surfaceStrong }]}><ShieldCheck color={colors.positive} size={16} /><Text style={[styles.pillText, { color: colors.positive }]}>On-device only</Text></View><Body muted>No receipt upload</Body></View>
    {moduleUnavailable && status ? <Banner tone="warning">{status.safeMessage} Manual expense entry remains available.</Banner> : null}
    {error ? <Banner tone="error">{error}</Banner> : null}
    <View accessibilityLabel="Portrait receipt camera preview" testID="receipt-camera-stage" style={[styles.cameraStage, { backgroundColor: colors.surfaceStrong, borderColor: colors.border }]}>
      {image ? <Image accessibilityLabel="Receipt photo preview" source={{ uri: image.uri }} resizeMode="contain" style={StyleSheet.absoluteFill} />
        : permission?.granted ? <CameraView ref={cameraRef} facing="back" ratio="16:9" testID="receipt-camera" style={StyleSheet.absoluteFill} />
          : <View style={styles.permission}><Camera color={colors.muted} size={42} /><Body muted>{permission?.canAskAgain === false ? 'Camera access is disabled in system settings.' : 'Allow camera access to photograph a receipt.'}</Body><Button variant="secondary" onPress={() => permission?.canAskAgain === false ? void Linking.openSettings() : void requestPermission()}>{permission?.canAskAgain === false ? 'Open settings' : 'Allow camera'}</Button></View>}
      {!image ? <><Corner position="topLeft" /><Corner position="topRight" /><Corner position="bottomLeft" /><Corner position="bottomRight" /><View style={styles.guidance}><Text style={styles.guidanceText}>Fit the full receipt inside the guide</Text></View></> : null}
      {processing ? <View style={[StyleSheet.absoluteFill, styles.processing]}><ActivityIndicator color="#FFFFFF" size="large" /><Text style={styles.processingTitle}>{phase === 'preparing' ? 'Preparing photo…' : 'Reading receipt locally…'}</Text><Text style={styles.processingBody}>Nothing leaves this phone.</Text></View> : null}
    </View>
    <View style={styles.privacy}><LockKeyhole color={colors.positive} size={18} /><Body style={styles.privacyText}><Text style={{ fontWeight: '800' }}>Private by design. </Text>The photo is read on this phone and is not attached to the expense.</Body></View>
    {image ? <View style={styles.previewActions}><View style={styles.action}><Button variant="secondary" disabled={processing} onPress={retake}>Retake</Button></View><View style={styles.action}><Button loading={processing} disabled={Boolean(moduleUnavailable)} onPress={() => void readReceipt()}>Read receipt</Button></View></View>
      : <View style={styles.controls}>
        <ScanSideAction label="Manual" icon={<Pencil color={colors.text} size={22} />} onPress={openManualEntry} />
        <Pressable accessibilityRole="button" accessibilityLabel="Take receipt photo" disabled={!permission?.granted || Boolean(moduleUnavailable)} onPress={() => void takePhoto()} style={({ pressed }) => [styles.shutterWrap, { opacity: !permission?.granted || moduleUnavailable ? 0.4 : pressed ? 0.72 : 1 }]}><View style={[styles.shutter, { borderColor: colors.text }]}><View style={[styles.shutterInner, { backgroundColor: colors.surfaceStrong }]} /></View><Text style={[styles.controlLabel, { color: colors.text }]}>Take photo</Text></Pressable>
        <ScanSideAction label="Photos" icon={<ImageIcon color={colors.text} size={22} />} disabled={Boolean(moduleUnavailable)} onPress={() => void choosePhoto()} />
      </View>}
  </Screen>;
}

function Corner({ position }: { position: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' }) {
  return <View pointerEvents="none" style={[styles.corner, styles[position]]} />;
}

function ScanSideAction({ label, icon, disabled, onPress }: { label: string; icon: React.ReactNode; disabled?: boolean; onPress(): void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label === 'Photos' ? 'Choose receipt from Photos' : 'Continue with manual expense entry'} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.sideAction, { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}>{icon}<Text style={[styles.controlLabel, { color: colors.text }]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 10, gap: 10 },
  groupContext: { minHeight: 20, fontSize: 12, lineHeight: 18, fontWeight: '800', letterSpacing: 1.2 },
  localStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  pill: { minHeight: 28, borderRadius: 999, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  pillText: { fontSize: 12, fontWeight: '800' },
  cameraStage: { flex: 1, minHeight: 0, overflow: 'hidden', borderRadius: 24, borderWidth: 1 },
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  corner: { position: 'absolute', width: 38, height: 38, borderColor: '#FFF9F2' },
  topLeft: { top: '10%', left: '12%', borderLeftWidth: 3, borderTopWidth: 3, borderTopLeftRadius: 9 },
  topRight: { top: '10%', right: '12%', borderRightWidth: 3, borderTopWidth: 3, borderTopRightRadius: 9 },
  bottomLeft: { bottom: '12%', left: '12%', borderLeftWidth: 3, borderBottomWidth: 3, borderBottomLeftRadius: 9 },
  bottomRight: { bottom: '12%', right: '12%', borderRightWidth: 3, borderBottomWidth: 3, borderBottomRightRadius: 9 },
  guidance: { position: 'absolute', alignSelf: 'center', bottom: 18, maxWidth: '82%', borderRadius: 999, backgroundColor: 'rgba(20,24,22,0.75)', paddingVertical: 8, paddingHorizontal: 12 },
  guidanceText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  processing: { backgroundColor: 'rgba(18,20,19,0.78)', alignItems: 'center', justifyContent: 'center', gap: 8 },
  processingTitle: { color: '#FFFFFF', fontWeight: '800', fontSize: 17 },
  processingBody: { color: '#E5E1DA', fontSize: 13 },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  privacyText: { flex: 1 },
  controls: { minHeight: 78, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-around' },
  sideAction: { width: 82, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 5 },
  shutterWrap: { width: 92, alignItems: 'center', gap: 5 },
  shutter: { width: 62, height: 62, padding: 5, borderRadius: 31, borderWidth: 3 },
  shutterInner: { flex: 1, borderRadius: 25 },
  controlLabel: { fontSize: 12, fontWeight: '800' },
  previewActions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },
});
