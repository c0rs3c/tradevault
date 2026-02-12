import LoginForm from './LoginForm';

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const nextParam = params?.next;
  const nextPath =
    typeof nextParam === 'string' && nextParam.startsWith('/') ? nextParam : '/dashboard';

  return <LoginForm nextPath={nextPath} />;
}

