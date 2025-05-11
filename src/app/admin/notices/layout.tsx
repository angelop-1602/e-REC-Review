import AdminNav from '../AdminNav';

export default function NoticesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div>
      <main>{children}</main>
    </div>
  );
} 