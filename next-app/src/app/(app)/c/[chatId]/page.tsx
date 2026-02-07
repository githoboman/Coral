'use client';

import { useCurrentAccount } from '@mysten/dapp-kit';
import { useRouter, useParams } from 'next/navigation';
import { useEffect } from 'react';
import DashboardPage from '@/app/(app)/page';

// Dynamic route for chat pages: /c/[chatId]
export default function ChatPage() {
  const currentAccount = useCurrentAccount();
  const router = useRouter();
  const params = useParams();
  const chatId = params?.chatId as string | undefined;

  // Redirect to signin if not authenticated
  useEffect(() => {
    if (!currentAccount) {
      router.replace('/signin');
    }
  }, [currentAccount, router]);

  // Reuse the Dashboard component
  return <DashboardPage />;
}
