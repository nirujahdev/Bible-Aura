import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Profile {
  id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  reading_streak: number;
  total_reading_days: number;
  favorite_translation: string;
  created_at: string;
  updated_at: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signInWithMagicLink: (email: string) => Promise<{ error: Error | null }>;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Profile>) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    let isMounted = true;
    
    // Increase timeout to 5 seconds for production stability
    const loadingTimeout = setTimeout(() => {
      if (isMounted) {
        console.log('Auth loading timeout, setting loading to false');
        setLoading(false);
      }
    }, 5000);

    const initializeAuth = async () => {
      try {
        // Add connection check first
        if (typeof window === 'undefined') {
          console.log('Running in server environment, skipping auth initialization');
          if (isMounted) {
            setLoading(false);
          }
          return;
        }

        // Check for existing session first
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error('Session error:', sessionError);
          // Don't fail completely on session errors in production
          if (isMounted) {
            setLoading(false);
            setSession(null);
            setUser(null);
            setProfile(null);
          }
          return;
        }

        if (isMounted) {
          clearTimeout(loadingTimeout);
          setSession(session);
          setUser(session?.user ?? null);
          
          if (session?.user) {
            // Don't wait for profile fetch to complete loading
            fetchUserProfile(session.user.id).catch(error => {
              console.error('Profile fetch error:', error);
              // Continue without profile rather than failing
            });
          } else {
            setProfile(null);
          }
          
          setLoading(false);
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
        if (isMounted) {
          clearTimeout(loadingTimeout);
          // Set safe defaults rather than failing
          setLoading(false);
          setSession(null);
          setUser(null);
          setProfile(null);
        }
      }
    };

    // Set up auth state listener with error handling
    let subscription: any;
    try {
      const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange(
        async (event, session) => {
          if (!isMounted) return;
          
          try {
            clearTimeout(loadingTimeout);
            setSession(session);
            setUser(session?.user ?? null);
            
            if (session?.user) {
              // Fetch user profile in the background with error handling
              fetchUserProfile(session.user.id).catch(error => {
                console.error('Profile fetch error in auth state change:', error);
              });
            } else {
              setProfile(null);
            }
            
            setLoading(false);
          } catch (error) {
            console.error('Auth state change error:', error);
            // Continue with safe defaults
            setLoading(false);
          }
        }
      );
      subscription = authSubscription;
    } catch (error) {
      console.error('Auth listener setup error:', error);
      // Initialize with safe defaults if listener fails
      if (isMounted) {
        clearTimeout(loadingTimeout);
        setLoading(false);
        setSession(null);
        setUser(null);
        setProfile(null);
      }
    }

    // Initialize auth
    initializeAuth();

    return () => {
      isMounted = false;
      if (subscription) {
        try {
          subscription.unsubscribe();
        } catch (error) {
          console.error('Error unsubscribing from auth:', error);
        }
      }
      clearTimeout(loadingTimeout);
    };
  }, []);

  const fetchUserProfile = async (userId: string) => {
    try {
      if (!userId || typeof window === 'undefined') {
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching profile:', error);
        return;
      }

      setProfile(data);
    } catch (error) {
      console.error('Error fetching profile:', error);
      // Don't fail the entire auth flow if profile fetch fails
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        toast({
          title: "Sign in failed",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Welcome back!",
          description: "Successfully signed in to your account.",
        });
      }

      return { error };
    } catch (error: unknown) {
      return { error: error as Error };
    }
  };

  const signInWithMagicLink = async (email: string) => {
    try {
      const redirectUrl = `${window.location.origin}/auth`;
      
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectUrl,
        },
      });

      if (error) {
        toast({
          title: "Magic link failed",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Check your email!",
          description: "We've sent you a magic link to sign in.",
        });
      }

      return { error };
    } catch (error: unknown) {
      return { error: error as Error };
    }
  };

  const signInWithGoogle = async () => {
    try {
      console.log('Google OAuth setup required:');
      console.log('1. Configure Google Cloud Console OAuth 2.0 Client');
      console.log('2. Add redirect URI: https://foleepziqgrdgkljedux.supabase.co/auth/v1/callback');
      console.log('3. Enable Google provider in Supabase Dashboard');
      console.log('4. Add Client ID and Secret to Supabase');
      
      const redirectUrl = `${window.location.origin}/auth`;
      
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
        },
      });

      if (error) {
        toast({
          title: "Google sign in failed",
          description: `${error.message}. Google OAuth requires setup - check console for instructions.`,
          variant: "destructive",
        });
        console.error('Google OAuth error:', error);
      }

      return { error };
    } catch (error: unknown) {
      return { error: error as Error };
    }
  };

  const signUp = async (email: string, password: string, displayName?: string) => {
    try {
      const redirectUrl = `${window.location.origin}/auth`;
      
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            display_name: displayName,
          },
        },
      });

      if (error) {
        toast({
          title: "Sign up failed",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Welcome to Bible Aura!",
          description: "Account created successfully! You can now start exploring.",
        });
      }

      return { error };
    } catch (error: unknown) {
      return { error: error as Error };
    }
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
      toast({
        title: "Signed out",
        description: "You have been successfully signed out.",
      });
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) return { error: new Error('No user logged in') };

    try {
      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('user_id', user.id);

      if (error) {
        toast({
          title: "Update failed",
          description: error.message,
          variant: "destructive",
        });
      } else {
        // Refresh profile data
        await fetchUserProfile(user.id);
        toast({
          title: "Profile updated",
          description: "Your profile has been successfully updated.",
        });
      }

      return { error };
    } catch (error: unknown) {
      return { error: error as Error };
    }
  };

  const value = {
    user,
    session,
    profile,
    loading,
    signIn,
    signInWithMagicLink,
    signInWithGoogle,
    signUp,
    signOut,
    updateProfile,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}