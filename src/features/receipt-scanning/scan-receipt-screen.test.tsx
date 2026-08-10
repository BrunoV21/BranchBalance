import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import { useGroup } from '@/providers/group-provider';
import { ThemeProvider } from '@/providers/theme-provider';

import ScanReceiptScreen from '../../app/(app)/groups/[owner]/[repo]/expenses/scan';

const mockGetStatus = jest.fn();
const mockRecognize = jest.fn();
const mockSetReceiptDraft = jest.fn();
const mockLaunchImageLibrary = jest.fn();

jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: () => ({ owner: 'owner', repo: 'trip' }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000099' }));
jest.mock('expo-camera', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const MockCameraView = React.forwardRef(function MockCameraView(props: object, ref: React.Ref<unknown>) { return React.createElement(View, { ...props, ref }); });
  return { CameraView: MockCameraView, useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()] };
});
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibrary(...args) }));
jest.mock('@/providers/group-provider', () => ({ useGroup: jest.fn() }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ session: { status: 'authenticated', account: { id: 1, login: 'alice' } } }) }));
jest.mock('@/features/receipt-scanning/receipt-draft-provider', () => ({ useReceiptDraft: () => ({ setReceiptDraft: mockSetReceiptDraft }) }));
jest.mock('@/features/receipt-scanning/prepare-receipt-image', () => ({
  cleanReceiptCache: jest.fn(async () => undefined),
  deleteCapturedReceipt: jest.fn(),
  deletePreparedReceipt: jest.fn(),
  prepareReceiptImage: jest.fn(async () => ({ uri: 'file:///cache/prepared.jpg', width: 1000, height: 1600 })),
}));
jest.mock('@/features/receipt-scanning/receipt-ocr', () => ({
  ReceiptOcrError: class ReceiptOcrError extends Error {
    readonly code: string;

    constructor(mockCode: string, message: string) {
      super(message);
      this.code = mockCode;
    }
  },
  receiptOcr: { getStatus: (...args: unknown[]) => mockGetStatus(...args), recognize: (...args: unknown[]) => mockRecognize(...args), cancel: jest.fn(async () => undefined) },
}));

describe('ScanReceiptScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useGroup).mockReturnValue({ state: { data: { key: 'owner/trip', group: { schema_version: 1, name: 'Trip', currency: 'EUR' } } } } as never);
    mockLaunchImageLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'content://receipt', width: 1000, height: 1600 }] });
  });

  it('keeps manual entry available when the native development build is missing', async () => {
    const replace = jest.fn();
    jest.mocked(useRouter).mockReturnValue({ replace } as never);
    mockGetStatus.mockResolvedValue({ state: 'module_unavailable', engine: 'paddle_ocr', profile: 'generic_v1', profileVersion: null, modelBundleVersion: null, safeMessage: 'Receipt scanning requires the BranchBalance development build.' });
    const view = await render(<ThemeProvider><ScanReceiptScreen /></ThemeProvider>);

    expect(await view.findByText(/requires the BranchBalance development build/)).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Continue with manual expense entry' }));
    expect(replace).toHaveBeenCalledWith({ pathname: '/groups/[owner]/[repo]/expenses/new', params: { owner: 'owner', repo: 'trip' } });
  });

  it('turns split native OCR blocks into an in-memory amount prefill', async () => {
    const replace = jest.fn();
    jest.mocked(useRouter).mockReturnValue({ replace } as never);
    mockGetStatus.mockResolvedValue({ state: 'ready', engine: 'paddle_ocr', profile: 'generic_v1', profileVersion: 'generic-v1-2026-08-10', modelBundleVersion: 'ppocr-v5-mobile-latin-2026-07-20', safeMessage: 'Receipt scanning is ready.' });
    mockRecognize.mockResolvedValue({ width: 1000, height: 1600, blocks: [
      { text: 'CAFE CENTRAL', confidence: 0.99, points: [{ x: 100, y: 60 }, { x: 800, y: 60 }, { x: 800, y: 120 }, { x: 100, y: 120 }] },
      { text: 'TOTAL EUR', confidence: 0.97, points: [{ x: 80, y: 1300 }, { x: 440, y: 1300 }, { x: 440, y: 1370 }, { x: 80, y: 1370 }] },
      { text: '43,27', confidence: 0.98, points: [{ x: 700, y: 1300 }, { x: 920, y: 1300 }, { x: 920, y: 1370 }, { x: 700, y: 1370 }] },
      { text: '20/07/2026', confidence: 0.98, points: [{ x: 300, y: 1450 }, { x: 700, y: 1450 }, { x: 700, y: 1510 }, { x: 300, y: 1510 }] },
    ] });
    const view = await render(<ThemeProvider><ScanReceiptScreen /></ThemeProvider>);

    expect(view.queryByText('Trip · Generic receipt')).toBeNull();
    expect(view.getByTestId('receipt-camera-stage')).toHaveStyle({ flex: 1, minHeight: 0 });
    expect(view.getByTestId('receipt-camera').props.ratio).toBe('16:9');

    await fireEvent.press(view.getByRole('button', { name: 'Choose receipt from Photos' }));
    expect(await view.findByLabelText('Receipt photo preview')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Read receipt' }));

    await waitFor(() => expect(mockSetReceiptDraft).toHaveBeenCalledWith(expect.objectContaining({ profile: 'generic_v1', description: 'CAFE CENTRAL', amount: '43.27', expenseDate: '2026-07-20' }), expect.objectContaining({ groupType: 'trip', groupKey: 'owner/trip' })));
    expect(replace).toHaveBeenCalledWith({ pathname: '/groups/[owner]/[repo]/expenses/new', params: { owner: 'owner', repo: 'trip' } });
  });

  it('routes a validated Fuel group only through the Fuel profile and parser', async () => {
    const replace = jest.fn();
    jest.mocked(useRouter).mockReturnValue({ replace } as never);
    jest.mocked(useGroup).mockReturnValue({ state: { data: { key: 'owner/trip', group: { schema_version: 2, group_type: 'fuel', name: 'Car', currency: 'EUR' } } } } as never);
    mockGetStatus.mockResolvedValue({ state: 'ready', engine: 'paddle_ocr', profile: 'fuel_v1', profileVersion: 'fuel-v1-2026-08-10', modelBundleVersion: 'ppocr-v5-mobile-latin-2026-07-20', safeMessage: 'Fuel scanning is ready.' });
    mockRecognize.mockResolvedValue({ width: 1000, height: 1600, blocks: [
      { text: 'GALP', confidence: 0.99, points: [{ x: 100, y: 60 }, { x: 800, y: 60 }, { x: 800, y: 120 }, { x: 100, y: 120 }] },
      { text: 'LITROS 24,500', confidence: 0.98, points: [{ x: 80, y: 800 }, { x: 900, y: 800 }, { x: 900, y: 860 }, { x: 80, y: 860 }] },
      { text: 'TOTAL EUR 40,01', confidence: 0.98, points: [{ x: 80, y: 1100 }, { x: 900, y: 1100 }, { x: 900, y: 1160 }, { x: 80, y: 1160 }] },
      { text: 'DESCONTO EUR 4,00', confidence: 0.98, points: [{ x: 80, y: 1200 }, { x: 900, y: 1200 }, { x: 900, y: 1260 }, { x: 80, y: 1260 }] },
      { text: 'AMOUNT PAID EUR 36,01', confidence: 0.99, points: [{ x: 80, y: 1300 }, { x: 900, y: 1300 }, { x: 900, y: 1360 }, { x: 80, y: 1360 }] },
    ] });
    const view = await render(<ThemeProvider><ScanReceiptScreen /></ThemeProvider>);
    await waitFor(() => expect(mockGetStatus).toHaveBeenCalledWith('fuel_v1'));
    expect(view.queryByText('Fuel receipt')).toBeNull();
    expect(view.queryByText(/remains disabled for production/)).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: 'Choose receipt from Photos' }));
    await fireEvent.press(view.getByRole('button', { name: 'Read receipt' }));
    await waitFor(() => expect(mockSetReceiptDraft).toHaveBeenCalledWith(expect.objectContaining({ profile: 'fuel_v1', description: 'GALP', amount: '36.01', litres: '24.5' }), expect.objectContaining({ groupType: 'fuel' })));
    expect(mockRecognize).toHaveBeenCalledWith(expect.any(String), 'file:///cache/prepared.jpg', 'fuel_v1');
  });
});
