import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Send, Bot, User, Book, MessageCircle, LogIn } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Link } from 'react-router-dom';
import { aiChatRateLimiter, getUserIdentifier } from '@/lib/enhancedRateLimiter';
import { DEEPSEEK_CONFIG, BIBLICAL_SYSTEM_PROMPT } from '@/lib/api-config';
import { PageLayout } from '@/components/PageLayout';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  model?: string;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  created_at: string;
  updated_at: string;
  user_id: string;
}

// Function to call DeepSeek Direct API with enhanced biblical focus
const callBiblicalAI = async (messages: Array<{role: 'user' | 'assistant', content: string}>) => {
  try {
    console.log('🤖 Calling Biblical AI:', {
      model: DEEPSEEK_CONFIG.model,
      baseURL: DEEPSEEK_CONFIG.baseURL,
      hasApiKey: !!DEEPSEEK_CONFIG.apiKey,
      messageCount: messages.length
    });

    // Enhanced request with timeout and retry logic
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const response = await fetch(`${DEEPSEEK_CONFIG.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Bible-Aura/1.0',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        model: DEEPSEEK_CONFIG.model,
        messages: [
          {
            role: "system",
            content: BIBLICAL_SYSTEM_PROMPT
          },
          ...messages.map(msg => ({
            role: msg.role,
            content: msg.content
          }))
        ],
        max_tokens: 2000,
        temperature: 0.7,
        stream: false
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid API response structure');
    }

    return {
      content: data.choices[0].message.content,
      model: data.model || DEEPSEEK_CONFIG.model
    };

  } catch (error: any) {
    console.error('❌ Biblical AI Error:', error);
    
    if (error.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    
    throw new Error(`Unable to connect: ${error.message}`);
  }
};

// Helper function to limit conversation to last 10 messages for performance
const limitMessagesToLast10 = (messages: Message[]): Message[] => {
  return messages.slice(-10);
};

export default function Chat() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Load conversations when user changes
  useEffect(() => {
    if (user) {
      loadConversations();
    }
  }, [user]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollElement = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [messages]);

  const loadConversations = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('ai_conversations')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      if (error) throw error;

      const formattedConversations = data?.map(conv => ({
        ...conv,
        messages: Array.isArray(conv.messages) ? (conv.messages as any[]).map((msg: any) => ({
          id: msg.id || Date.now().toString(),
          role: msg.role,
          content: msg.content,
          timestamp: typeof msg.timestamp === 'string' ? msg.timestamp : new Date(msg.timestamp).toISOString(),
          model: msg.model
        })) : []
      })) || [];

      setConversations(formattedConversations);
    } catch (error) {
      console.error('Error loading conversations:', error);
    }
  };

  const createNewConversation = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('ai_conversations')
        .insert({
          user_id: user.id,
          title: 'New Biblical Conversation',
          messages: []
        })
        .select()
        .single();

      if (error) throw error;

      const newConversation: Conversation = {
        ...data,
        messages: []
      };

      setConversations(prev => [newConversation, ...prev]);
      setCurrentConversation(newConversation);
      setMessages([]);
    } catch (error) {
      console.error('Error creating conversation:', error);
      toast({
        title: "Error",
        description: "Failed to create new conversation",
        variant: "destructive",
      });
    }
  };

  const selectConversation = (conversation: Conversation) => {
    setCurrentConversation(conversation);
    setMessages(conversation.messages.map(msg => ({
      ...msg,
      timestamp: typeof msg.timestamp === 'string' ? msg.timestamp : new Date(msg.timestamp).toISOString()
    })));
  };

  const sendMessage = async () => {
    if (!input.trim() || !user) return;

    // Check rate limits
    const userIdentifier = getUserIdentifier(user?.id);
    const rateLimitCheck = aiChatRateLimiter.checkLimit(userIdentifier);
    
    if (!rateLimitCheck.allowed) {
      const resetTime = new Date(rateLimitCheck.resetTime!);
      const remainingMinutes = Math.ceil((rateLimitCheck.resetTime! - Date.now()) / 60000);
      
      toast({
        title: "Rate Limit Exceeded",
        description: `Please wait ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''} before sending another message.`,
        variant: "destructive",
      });
      return;
    }

    // If no current conversation, create one
    let conversation = currentConversation;
    if (!conversation) {
      await createNewConversation();
      conversation = currentConversation;
      if (!conversation) return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Prepare conversation history for AI (limit to last 10 for optimal performance)
      const fullHistory = [...messages, userMessage];
      const limitedHistory = limitMessagesToLast10(fullHistory);
      const conversationHistory = limitedHistory.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      }));

      console.log(`🧠 Sending ${conversationHistory.length} messages to AI (limited from ${fullHistory.length} total)`);

      // Call biblical AI with optimized conversation history
      const aiResponse = await callBiblicalAI(conversationHistory);

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: aiResponse.content,
        timestamp: new Date().toISOString(),
        model: aiResponse.model
      };

      const updatedMessages = [...messages, userMessage, aiMessage];
      setMessages(updatedMessages);

      // Limit to last 10 messages for database storage (saves space and improves performance)
      const limitedMessages = limitMessagesToLast10(updatedMessages);

      // Update conversation in database with only last 10 messages
      const { error } = await supabase
        .from('ai_conversations')
        .update({
          messages: limitedMessages as any,
          title: conversation.title === 'New Biblical Conversation' 
            ? userMessage.content.slice(0, 50) + (userMessage.content.length > 50 ? '...' : '')
            : conversation.title,
          updated_at: new Date().toISOString()
        })
        .eq('id', conversation.id);

      console.log(`💾 Saved ${limitedMessages.length} messages to database (limited from ${updatedMessages.length} total)`);

      // Notify user about message limiting for long conversations
      if (updatedMessages.length > 10 && updatedMessages.length % 5 === 0) {
        toast({
          title: "📚 Conversation History",
          description: `Keeping last 10 messages for optimal performance. Your current session shows all ${updatedMessages.length} messages.`,
        });
      }

      if (error) throw error;

      // Refresh conversations list
      await loadConversations();
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Add error message to chat
      const errorMessage: Message = {
        id: (Date.now() + 2).toString(),
        role: 'assistant',
        content: `I apologize, but I'm experiencing some difficulty connecting to provide biblical insights. This could be due to:\n\n• Network connectivity issues\n• AI service temporarily unavailable\n• Rate limiting\n\nPlease try again in a moment. In the meantime, you can reflect on your question, and I'll be ready to provide biblical wisdom when the connection is restored.\n\n"Be still, and know that I am God" - Psalm 46:10`,
        timestamp: new Date().toISOString()
      };

      setMessages(prev => [...prev, errorMessage]);

      toast({
        title: "Connection Error",
        description: "Having trouble reaching the AI service. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const useQuickPrompt = (prompt: string) => {
    setInput(prompt);
  };

  const renderMessage = (message: Message) => {
    const isAI = message.role === 'assistant';
    
    return (
      <div key={message.id} className={`flex gap-4 mb-6 ${isAI ? 'justify-start' : 'justify-end'}`}>
        {isAI && (
          <div className="flex-shrink-0">
            <Avatar className="h-10 w-10">
                                  <AvatarImage src="" alt="✦ Bible Aura AI" />
              <AvatarFallback className="bg-primary text-white">
                <Bot className="h-5 w-5" />
              </AvatarFallback>
            </Avatar>
          </div>
        )}
        
        <div className={`max-w-[70%] ${isAI ? 'mr-auto' : 'ml-auto'}`}>
          <div className={`p-4 rounded-2xl ${
            isAI 
              ? 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700' 
              : 'bg-primary text-white'
          }`}>
            <div className="prose prose-sm max-w-none">
              <div className={`whitespace-pre-wrap leading-relaxed ${
                isAI 
                  ? 'text-gray-800 dark:text-gray-200' 
                  : 'text-white'
              }`}>
                {message.content}
              </div>
            </div>
            
            <div className={`text-xs mt-3 flex justify-between items-center ${
              isAI 
                ? 'text-gray-500 dark:text-gray-400' 
                : 'text-white/70'
            }`}>
              <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
              {isAI && message.model && (
                <span className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                  {message.model}
                </span>
              )}
            </div>
          </div>
        </div>
        
        {!isAI && (
          <div className="flex-shrink-0">
            <Avatar className="h-10 w-10">
              <AvatarImage src={profile?.avatar_url} />
              <AvatarFallback className="bg-primary text-white">
                <User className="h-5 w-5" />
              </AvatarFallback>
            </Avatar>
          </div>
        )}
      </div>
    );
  };

  if (!user) {
    return (
      <div className="h-screen bg-background flex flex-col items-center justify-center p-8">
        <div className="text-center space-y-6 max-w-md">
          <MessageCircle className="h-16 w-16 text-primary mx-auto" />
          <h1 className="text-3xl font-bold text-primary">Bible Aura AI</h1>
          <p className="text-muted-foreground text-lg">
            Discover biblical wisdom through scriptural insights
          </p>
          <p className="text-sm text-muted-foreground">
            Please sign in to start your biblical conversation
          </p>
          <Button 
            asChild 
            size="lg"
            className="bg-primary hover:bg-primary/90"
          >
            <Link to="/auth">
              <LogIn className="h-4 w-4 mr-2" />
              Sign In
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <PageLayout padding="none" maxWidth="full">
    <div className="h-screen bg-background flex flex-col w-full">
      {/* Enhanced Mobile-First Header */}
      <div className="bg-gradient-to-r from-primary to-primary/90 text-white p-4 border-b shadow-lg flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 flex items-center justify-center bg-white/20 rounded-lg backdrop-blur-sm">
              <span className="text-lg font-bold">✦</span>
            </div>
            <div className="flex flex-col">
              <h1 className="text-lg sm:text-xl font-semibold">Bible Aura AI</h1>
              <p className="text-xs text-white/80 hidden sm:block">Ask anything about Scripture</p>
            </div>
          </div>
          <div className="text-xs text-white/80 hidden md:block">
            Powered by Bible Aura AI
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden w-full">
        {/* Conversations Sidebar - Hidden on mobile */}
        <div className="hidden lg:flex lg:w-72 xl:w-80 border-r bg-gray-50 flex-shrink-0">
          <div className="flex flex-col w-full">
            <div className="p-4 border-b">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-800">Conversations</h2>
                <Button
                  size="sm"
                  onClick={createNewConversation}
                  className="bg-primary hover:bg-primary/90"
                >
                  <Book className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-2">
                {conversations.length === 0 ? (
                  <div className="text-center text-muted-foreground text-sm py-8">
                    Your conversations will appear here
                  </div>
                ) : (
                  conversations.map((conv) => (
                    <Button
                      key={conv.id}
                      variant={currentConversation?.id === conv.id ? "default" : "ghost"}
                      className="w-full justify-start text-left h-auto p-3"
                      onClick={() => selectConversation(conv)}
                    >
                      <div className="truncate">
                        <div className="font-medium text-sm">{conv.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(conv.updated_at).toLocaleDateString()}
                        </div>
                      </div>
                    </Button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col min-w-0 w-full">
          <div className="flex flex-col h-full w-full">
            {/* Chat Header - Mobile/Desktop */}
            <div className="border-b p-4 flex-shrink-0">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-8 w-8 flex items-center justify-center bg-primary/10 rounded-lg flex-shrink-0">
                    <span className="text-sm font-bold text-primary">✦</span>
                  </div>
                  <h2 className="font-semibold text-gray-800 truncate">Bible Aura AI</h2>
                </div>
                <div className="text-sm text-muted-foreground hidden sm:block flex-shrink-0">
                  Bible-Based Responses
                </div>
              </div>
            </div>

            {/* Messages Area */}
            <ScrollArea className="flex-1 p-4 w-full" ref={scrollAreaRef}>
              {messages.length === 0 ? (
                <div className="text-center py-12">
                  <div className="relative mx-auto w-24 h-24 mb-6">
                    <div className="w-full h-full flex items-center justify-center bg-primary/10 rounded-lg">
                      <span className="text-2xl font-bold text-primary">✦</span>
                    </div>
                  </div>
                  <h3 className="text-xl font-semibold text-primary mb-3">
                    Welcome to Bible Aura AI
                  </h3>
                  <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                    Ask me anything about Scripture, seek biblical guidance, or explore the wisdom of God's Word.
                  </p>
                </div>
                              ) : (
                <div className="space-y-4 max-w-4xl mx-auto w-full">
                  {messages.map(renderMessage)}
                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src="" alt="Bible Aura AI" />
                          <AvatarFallback className="bg-primary text-white">
                            <Bot className="h-5 w-5" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="bg-white dark:bg-gray-800 border rounded-2xl p-4">
                          <div className="flex items-center gap-2">
                            <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                            <span className="text-sm text-muted-foreground">Seeking biblical wisdom...</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>

            {/* Input Area */}
            <div className="border-t p-4 bg-gray-50 flex-shrink-0">
              <div className="flex gap-2 w-full max-w-4xl mx-auto">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Ask your biblical question..."
                  disabled={isLoading}
                  className="flex-1 bg-white min-w-0"
                />
                <Button
                  onClick={sendMessage}
                  disabled={!input.trim() || isLoading}
                  className="bg-primary hover:bg-primary/90 flex-shrink-0"
                >
                  {isLoading ? (
                    <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </PageLayout>
  );
}