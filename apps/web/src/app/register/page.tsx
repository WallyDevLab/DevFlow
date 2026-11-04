import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Create account · DevFlow" };

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
