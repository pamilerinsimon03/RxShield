import { Html, Head, Main, NextScript } from 'next/document';

const Document = (): JSX.Element => {
  return (
    <Html lang="en">
      <Head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#F8FAFC" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
};

export default Document;
