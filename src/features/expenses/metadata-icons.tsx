import { Banknote, BedDouble, Car, CircleHelp, CreditCard, Ellipsis, ReceiptText, ShoppingBag, ShoppingBasket, Sparkles, Utensils, WalletCards } from 'lucide-react-native';

import type { CategoryBucket, PaymentMethodBucket } from '@/domain/spending';
import { useTheme } from '@/providers/theme-provider';

type MetadataIconProps = {
  color?: string;
  size?: number;
};

export function CategoryIcon({ category, color, size = 20 }: MetadataIconProps & { category: CategoryBucket }) {
  const { colors } = useTheme();
  const props = { color: color ?? colors.accent, size, strokeWidth: 2.2 };
  switch (category) {
    case 'accommodation': return <BedDouble {...props} />;
    case 'food_drink': return <Utensils {...props} />;
    case 'groceries': return <ShoppingBasket {...props} />;
    case 'transport': return <Car {...props} />;
    case 'activities': return <Sparkles {...props} />;
    case 'shopping': return <ShoppingBag {...props} />;
    case 'fees': return <ReceiptText {...props} />;
    case 'other': return <Ellipsis {...props} />;
    case 'uncategorized': return <CircleHelp {...props} />;
  }
}

export function PaymentMethodIcon({ method, color, size = 20 }: MetadataIconProps & { method: PaymentMethodBucket }) {
  const { colors } = useTheme();
  const props = { color: color ?? colors.accent, size, strokeWidth: 2.2 };
  switch (method) {
    case 'card': return <CreditCard {...props} />;
    case 'cash': return <Banknote {...props} />;
    case 'other': return <WalletCards {...props} />;
    case 'unspecified': return <CircleHelp {...props} />;
  }
}
