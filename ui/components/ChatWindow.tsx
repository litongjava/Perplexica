'use client';

import {useEffect, useRef, useState} from 'react';
import {Document} from '@langchain/core/documents';
import Navbar from './Navbar';
import Chat from './Chat';
import EmptyChat from './EmptyChat';
import {toast} from 'sonner';
import {useSearchParams} from 'next/navigation';
import {getSuggestions} from '@/lib/actions';
import {Settings} from 'lucide-react';
import SettingsDialog from './SettingsDialog';
import NextError from 'next/error';
import {Mcid} from '@/lib/mcid';
import {sendSSERequest, SSEEvent} from "@/utils/sseClient";

export type Message = {
  messageId: string;
  chatId: string;
  createdAt: Date;
  reasoning?: string;
  content: string;
  role: 'user' | 'assistant';
  suggestions?: string[];
  sources?: Document[];
};

export interface File {
  fileName: string;
  fileExtension: string;
  fileId: string;
};

const loadMessages = async (
  chatId: string,
  setMessages: (messages: Message[]) => void,
  setIsMessagesLoaded: (loaded: boolean) => void,
  setChatHistory: (history: [string, string][]) => void,
  setFocusMode: (mode: string) => void,
  setNotFound: (notFound: boolean) => void,
  setFiles: (files: File[]) => void,
  setFileIds: (fileIds: string[]) => void,
) => {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/chats/${chatId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (res.status === 404) {
    setNotFound(true);
    setIsMessagesLoaded(true);
    return;
  }

  const data = await res.json();
  const messages = data.messages.map((msg: any) => ({...msg})) as Message[];
  setMessages(messages);

  const history = messages.map((msg) => [msg.role, msg.content]) as [string, string][];
  console.debug(new Date(), 'app:messages_loaded');

  if (messages.length > 0) {
    document.title = messages[0].content;
  }

  const files = data.chat.files && data.chat.files.map((file: any) => ({
    fileName: file.name,
    fileExtension: file.name.split('.').pop(),
    fileId: file.fileId,
  }));
  setFiles(files);
  setFileIds(files && files.map((file: File) => file.fileId));

  setChatHistory(history);
  setFocusMode(data.chat.focusMode);
  setIsMessagesLoaded(true);
};

const ChatWindow = ({id}: { id?: string }) => {
  const searchParams = useSearchParams();
  const initialMessage = searchParams.get('q');
  const [userId, setUserId] = useState<string | undefined>();
  const [chatId, setChatId] = useState<string | undefined>(id);
  const [newChatCreated, setNewChatCreated] = useState(false);

  const [hasError, setHasError] = useState(false);
  // 对于 SSE，我们以消息加载完成和用户初始化作为就绪标志
  const [isReady, setIsReady] = useState(false);

  const [loading, setLoading] = useState(false);
  const [messageAppeared, setMessageAppeared] = useState(false);

  const [chatHistory, setChatHistory] = useState<[string, string][]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  const [files, setFiles] = useState<File[]>([]);
  const [fileIds, setFileIds] = useState<string[]>([]);

  const [focusMode, setFocusMode] = useState('webSearch');
  const [optimizationMode, setOptimizationMode] = useState('speed');
  const [copilotEnabled, setCopilotEnabled] = useState(true);

  const [isMessagesLoaded, setIsMessagesLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // 保存用户 ID
  useEffect(() => {
    const initializeUserId = () => {
      try {
        const storedUserId = localStorage.getItem('userId');
        if (storedUserId) {
          setUserId(storedUserId);
          console.debug('Using existing user ID:', storedUserId);
        } else {
          const newUserId = new Mcid().generate().toString();
          localStorage.setItem('userId', newUserId);
          setUserId(newUserId);
          console.debug('Generated new user ID:', newUserId);
        }
      } catch (error) {
        console.error('Error initializing user ID:', error);
        const fallbackId = '1234567890';
        localStorage.setItem('userId', fallbackId);
        setUserId(fallbackId);
      }
    };
    initializeUserId();
  }, []);

  // 加载历史消息
  useEffect(() => {
    if (chatId && !newChatCreated && !isMessagesLoaded && messages.length === 0) {
      loadMessages(
        chatId,
        setMessages,
        setIsMessagesLoaded,
        setChatHistory,
        setFocusMode,
        setNotFound,
        setFiles,
        setFileIds,
      );
    } else if (!chatId) {
      setNewChatCreated(true);
      setIsMessagesLoaded(true);
      setChatId(new Mcid().generate().toString());
    }
  }, [chatId, newChatCreated, isMessagesLoaded, messages]);

  useEffect(() => {
    const savedFocusMode = localStorage.getItem('focusMode');
    if (savedFocusMode) {
      setFocusMode(savedFocusMode);
    }
  }, []);

  const handleFocusModeChange = (mode: string) => {
    localStorage.setItem('focusMode', mode);
    setFocusMode(mode);
  };

  useEffect(() => {
    const mode = localStorage.getItem('optimizationMode');
    if (mode) {
      setOptimizationMode(mode);
    }
  }, []);

  const handleOptimizationModeChange = (mode: string) => {
    localStorage.setItem('optimizationMode', mode);
    setOptimizationMode(mode);
  };

  const messagesRef = useRef<Message[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (isMessagesLoaded && userId) {
      setIsReady(true);
      console.debug(new Date(), 'app:ready');
    } else {
      setIsReady(false);
    }
  }, [isMessagesLoaded, userId]);

  // 使用 SSE 发送消息，替换之前的 ws.send 及事件监听逻辑
  const sendMessage = async (message: string, messageId?: string) => {
    if (loading) return;
    setLoading(true);
    setMessageAppeared(false);

    let sources: Document[] | undefined = undefined;
    let receivedMessage = '';
    let added = false;
    messageId = messageId ?? new Mcid().generate().toString();

    // 先添加用户消息
    setMessages((prevMessages) => [
      ...prevMessages,
      {
        content: message,
        messageId: messageId,
        chatId: chatId!,
        role: 'user',
        createdAt: new Date(),
      },
    ]);


    let onEvent = (event: SSEEvent) => {
      if (event.type === 'done' || !event.data) return;

      const data = JSON.parse(event.data);
      if (data.type === 'error') {
        toast.error(data.data);
        setLoading(false);
        return;
      }
      if (data.type === 'sources') {
        setMessages((prevMessages) =>
          prevMessages.map((msg) => {
            if (msg.messageId === data.messageId) {
              return {...msg, sources: data.data};
            }
            return msg;
          })
        );
        setMessageAppeared(true);
      }
      if (data.type === 'reasoning') {
        setMessages((prevMessages) =>
          prevMessages.map((msg) => {
            if (msg.messageId === data.messageId) {
              return {...msg, reasoning: (msg.reasoning || '') + data.data};
            }
            return msg;
          }),
        );
        return;
      }
      if (data.type === 'message') {
        if (!added) {
          setMessages((prevMessages) => [
            ...prevMessages,
            {
              content: data.data,
              messageId: data.messageId,
              chatId: chatId!,
              role: 'assistant',
              sources: sources,
              createdAt: new Date(),
            },
          ]);
          added = true;
        } else {
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.messageId === data.messageId) {
                return {...msg, content: msg.content + data.data};
              }
              return msg;
            }),
          );
        }
        receivedMessage += data.data;
        setMessageAppeared(true);
      }
      if (data.type === 'messageEnd') {
        setChatHistory((prevHistory) => [
          ...prevHistory,
          ['human', message],
          ['assistant', receivedMessage],
        ]);
        setLoading(false);
        const lastMsg = messagesRef.current[messagesRef.current.length - 1];
        if (
          lastMsg &&
          lastMsg.role === 'assistant' &&
          lastMsg.sources &&
          lastMsg.sources.length > 0 &&
          !lastMsg.suggestions
        ) {
          getSuggestions(messagesRef.current).then((suggestions) => {
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.messageId === lastMsg.messageId) {
                  return {...msg, suggestions: suggestions};
                }
                return msg;
              }),
            );
          });
        }
      }
    };
    try {
      await sendSSERequest({
        accessToken: null,
        payload: {
          type: 'message',
          userId: userId!,
          message: {
            messageId: messageId,
            chatId: chatId!,
            content: message,
          },
          files: fileIds,
          focusMode: focusMode,
          copilotEnabled: copilotEnabled,
          optimizationMode: optimizationMode,
          history: [],
        },
        onEvent: onEvent,
      });
    } catch (err: any) {
      //toast.error('Error sending message: ' + err.message);
      console.error('Error sending message: ' + err.message);
      setLoading(false);
    }
  };

  const rewrite = (messageId: string) => {
    const index = messages.findIndex((msg) => msg.messageId === messageId);
    if (index === -1) return;
    const message = messages[index - 1];
    setMessages((prev) => prev.slice(0, messages.length > 2 ? index - 1 : 0));
    setChatHistory((prev) => prev.slice(0, messages.length > 2 ? index - 1 : 0));
    sendMessage(message.content, message.messageId);
  };

  // 如果有初始消息，则在就绪后发送
  useEffect(() => {
    if (isReady && initialMessage) {
      sendMessage(initialMessage);
    }
  }, [isReady, initialMessage]);

  if (hasError) {
    return (
      <div className="relative">
        <div className="absolute w-full flex flex-row items-center justify-end mr-5 mt-5">
          <Settings className="cursor-pointer lg:hidden" onClick={() => setIsSettingsOpen(true)}/>
        </div>
        <div className="flex flex-col items-center justify-center min-h-screen">
          <p className="dark:text-white/70 text-black/70 text-sm">
            Failed to connect to the server. Please try again later.
          </p>
        </div>
        <SettingsDialog isOpen={isSettingsOpen} setIsOpen={setIsSettingsOpen}/>
      </div>
    );
  }

  return isReady ? (
    notFound ? (
      <NextError statusCode={404}/>
    ) : (
      <div>
        {messages.length > 0 ? (
          <>
            <Navbar chatId={chatId!} messages={messages}/>
            <Chat
              loading={loading}
              messages={messages}
              sendMessage={sendMessage}
              messageAppeared={messageAppeared}
              rewrite={rewrite}
              fileIds={fileIds}
              setFileIds={setFileIds}
              files={files}
              setFiles={setFiles}
              copilotEnabled={copilotEnabled}
              setCopilotEnabled={setCopilotEnabled}
            />
          </>
        ) : (
          <EmptyChat
            sendMessage={sendMessage}
            focusMode={focusMode}
            copilotEnabled={copilotEnabled}
            setCopilotEnabled={setCopilotEnabled}
            setFocusMode={handleFocusModeChange}
            optimizationMode={optimizationMode}
            setOptimizationMode={handleOptimizationModeChange}
            fileIds={fileIds}
            setFileIds={setFileIds}
            files={files}
            setFiles={setFiles}
          />
        )}
      </div>
    )
  ) : (
    <div className="flex flex-row items-center justify-center min-h-screen">
      <svg
        aria-hidden="true"
        className="w-8 h-8 text-light-200 fill-light-secondary dark:text-[#202020] animate-spin dark:fill-[#ffffff3b]"
        viewBox="0 0 100 101"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M100 50.5908C100.003 78.2051 78.1951 100.003 50.5908 100C22.9765 99.9972 0.997224 78.018 1 50.4037C1.00281 22.7993 22.8108 0.997224 50.4251 1C78.0395 1.00281 100.018 22.8108 100 50.4251ZM9.08164 50.594C9.06312 73.3997 27.7909 92.1272 50.5966 92.1457C73.4023 92.1642 92.1298 73.4365 92.1483 50.6308C92.1669 27.8251 73.4392 9.0973 50.6335 9.07878C27.8278 9.06026 9.10003 27.787 9.08164 50.594Z"
          fill="currentColor"
        />
        <path
          d="M93.9676 39.0409C96.393 38.4037 97.8624 35.9116 96.9801 33.5533C95.1945 28.8227 92.871 24.3692 90.0681 20.348C85.6237 14.1775 79.4473 9.36872 72.0454 6.45794C64.6435 3.54717 56.3134 2.65431 48.3133 3.89319C45.869 4.27179 44.3768 6.77534 45.014 9.20079C45.6512 11.6262 48.1343 13.0956 50.5786 12.717C56.5073 11.8281 62.5542 12.5399 68.0406 14.7911C73.527 17.0422 78.2187 20.7487 81.5841 25.4923C83.7976 28.5886 85.4467 32.059 86.4416 35.7474C87.1273 38.1189 89.5423 39.6781 91.9676 39.0409Z"
          fill="currentFill"
        />
      </svg>
    </div>
  );
};

export default ChatWindow;
