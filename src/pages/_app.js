import AppProviders from '../components/AppProviders';
import '../index.css';

export default function App({ Component, pageProps }) {
  return (
    <AppProviders>
      <Component {...pageProps} />
    </AppProviders>
  );
}
