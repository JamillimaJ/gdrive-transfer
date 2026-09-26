"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const endpoint = isLogin ? "/api/app-auth/login" : "/api/app-auth/register";
    const res = await fetch(`http://localhost:8000${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: email, password: password }),
    });

    if (res.ok) {
      const data = await res.json();
      localStorage.setItem("token", data.access_token);
      router.push("/");
    } else {
      const data = await res.json();
      setError(data.detail || "Authentication failed");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md border border-foreground bg-background p-8 newsprint-texture hard-shadow-hover transition-all duration-300">
        
        <div className="mb-8 border-b-4 border-foreground pb-4">
          <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 mb-2">Multi-Drive Manager</p>
          <h2 className="text-4xl font-serif font-black tracking-tighter">
            {isLogin ? "Sign In." : "Sign Up."}
          </h2>
        </div>

        {error && (
          <div className="mb-6 border border-accent bg-background p-3 text-sm font-mono text-accent">
            Error: {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block font-mono text-xs uppercase tracking-widest text-neutral-700 mb-1">Email Address</label>
            <input 
              type="email" 
              required 
              className="w-full border-b-2 border-foreground bg-transparent px-2 py-2 font-mono text-sm focus-visible:bg-neutral-100 focus-visible:outline-none transition-colors"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="editor@times.com"
            />
          </div>
          <div>
            <label className="block font-mono text-xs uppercase tracking-widest text-neutral-700 mb-1">Password</label>
            <input 
              type="password" 
              required 
              className="w-full border-b-2 border-foreground bg-transparent px-2 py-2 font-mono text-sm focus-visible:bg-neutral-100 focus-visible:outline-none transition-colors"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          
          <button 
            type="submit" 
            className="w-full border border-foreground bg-foreground text-background py-3 font-sans text-sm font-bold uppercase tracking-widest hover:bg-background hover:text-foreground transition-all duration-200"
          >
            {isLogin ? "Authenticate" : "Register"}
          </button>
        </form>
        
        <div className="my-8 flex items-center justify-center gap-4">
          <div className="h-px bg-muted flex-1"></div>
          <span className="font-mono text-xs uppercase tracking-widest text-neutral-500">Or</span>
          <div className="h-px bg-muted flex-1"></div>
        </div>
        
        <a 
          href="http://localhost:8000/api/auth/google/login"
          className="flex w-full items-center justify-center gap-3 border border-foreground bg-transparent py-3 font-sans text-sm font-bold uppercase tracking-widest text-foreground hover:bg-foreground hover:text-background transition-all duration-200"
        >
          Continue with Google
        </a>

        <div className="mt-8 text-center border-t border-muted pt-6">
          <button 
            onClick={() => setIsLogin(!isLogin)} 
            className="font-mono text-xs uppercase tracking-widest text-foreground underline decoration-1 underline-offset-4 hover:decoration-accent hover:text-accent transition-colors"
          >
            {isLogin ? "Need an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
