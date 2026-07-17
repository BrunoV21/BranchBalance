import { Redirect } from 'expo-router';

import { useSession } from '@/providers/session-provider';

export default function Index() {
  const { session } = useSession();
  if (session.status === 'hydrating') return null;
  return <Redirect href={(session.status === 'authenticated' ? '/groups' : '/sign-in') as never} />;
}
