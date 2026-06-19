import { useState } from 'react';
import type { NextPage } from 'next';
import Head from 'next/head';
import { WorkflowStateProvider } from '@/context/WorkflowStateContext';
import { AccessShield } from '@/components/Dashboard/AccessShield';
import { MainLayout } from '@/components/Dashboard/MainLayout';

const Home: NextPage = (): JSX.Element => {
  const [isUnlocked, setIsUnlocked] = useState<boolean>(false);

  return (
    <WorkflowStateProvider>
      <Head>
        <title>RxShield Edge Workbench</title>
        <meta name="description" content="Offline-first clinical decision support at the edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
      </Head>

      {!isUnlocked ? (
        <AccessShield onUnlock={() => setIsUnlocked(true)} />
      ) : (
        <MainLayout />
      )}
    </WorkflowStateProvider>
  );
};

export default Home;
