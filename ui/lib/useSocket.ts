'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

const useSocket = (
  url: string,
  setIsWSReady: (ready: boolean) => void,
  setError: (error: boolean) => void,
) => {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const retryCountRef = useRef(0);
  const isCleaningUpRef = useRef(false);
  const MAX_RETRIES = 3;
  const INITIAL_BACKOFF = 1000; // 1 秒

  const getBackoffDelay = (retryCount: number) => {
    return Math.min(INITIAL_BACKOFF * Math.pow(2, retryCount), 10000); // 最多延迟 10 秒
  };

  useEffect(() => {
    const connectWs = async () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }

      try {
        let chatModel = localStorage.getItem('chatModel');
        let chatModelProvider = localStorage.getItem('chatModelProvider');
        let embeddingModel = localStorage.getItem('embeddingModel');
        let embeddingModelProvider = localStorage.getItem('embeddingModelProvider');
        let openAIBaseURL =
          chatModelProvider === 'custom_openai'
            ? localStorage.getItem('openAIBaseURL')
            : null;
        let openAIPIKey =
          chatModelProvider === 'custom_openai'
            ? localStorage.getItem('openAIApiKey')
            : null;

        const providers = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/models`,
          {
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ).then(async (res) => {
          if (!res.ok)
            throw new Error(
              `Failed to fetch models: ${res.status} ${res.statusText}`,
            );
          return res.json();
        });

        if (
          !chatModel ||
          !chatModelProvider ||
          !embeddingModel ||
          !embeddingModelProvider
        ) {
          if (!chatModel || !chatModelProvider) {
            const chatModelProviders = providers.chatModelProviders;
            chatModelProvider =
              chatModelProvider || Object.keys(chatModelProviders)[0];

            if (chatModelProvider === 'custom_openai') {
              toast.error(
                '似乎你正在使用自定义 OpenAI 服务，请在设置中输入模型名称。',
              );
              setError(true);
              return;
            } else {
              chatModel = Object.keys(chatModelProviders[chatModelProvider])[0];
              if (!chatModelProviders || Object.keys(chatModelProviders).length === 0)
                return toast.error('没有可用的聊天模型');
            }
          }

          if (!embeddingModel || !embeddingModelProvider) {
            const embeddingModelProviders = providers.embeddingModelProviders;
            if (!embeddingModelProviders || Object.keys(embeddingModelProviders).length === 0)
              return toast.error('没有可用的嵌入模型');

            embeddingModelProvider = Object.keys(embeddingModelProviders)[0];
            embeddingModel = Object.keys(embeddingModelProviders[embeddingModelProvider])[0];
          }

          localStorage.setItem('chatModel', chatModel!);
          localStorage.setItem('chatModelProvider', chatModelProvider);
          localStorage.setItem('embeddingModel', embeddingModel!);
          localStorage.setItem(
            'embeddingModelProvider',
            embeddingModelProvider,
          );
        } else {
          const chatModelProviders = providers.chatModelProviders;
          const embeddingModelProviders = providers.embeddingModelProviders;

          if (
            Object.keys(chatModelProviders).length > 0 &&
            (((!openAIBaseURL || !openAIPIKey) &&
                chatModelProvider === 'custom_openai') ||
              !chatModelProviders[chatModelProvider])
          ) {
            const chatModelProvidersKeys = Object.keys(chatModelProviders);
            chatModelProvider =
              chatModelProvidersKeys.find(
                (key) => Object.keys(chatModelProviders[key]).length > 0,
              ) || chatModelProvidersKeys[0];

            if (
              chatModelProvider === 'custom_openai' &&
              (!openAIBaseURL || !openAIPIKey)
            ) {
              toast.error(
                '似乎你正在使用自定义 OpenAI 服务，请在设置中配置 API Key 和 Base URL',
              );
              setError(true);
              return;
            }

            localStorage.setItem('chatModelProvider', chatModelProvider);
          }

          if (
            chatModelProvider &&
            (!openAIBaseURL || !openAIPIKey) &&
            !chatModelProviders[chatModelProvider][chatModel]
          ) {
            chatModel = Object.keys(
              chatModelProviders[
                Object.keys(chatModelProviders[chatModelProvider]).length > 0
                  ? chatModelProvider
                  : Object.keys(chatModelProviders)[0]
                ],
            )[0];
            localStorage.setItem('chatModel', chatModel);
          }

          if (
            Object.keys(embeddingModelProviders).length > 0 &&
            !embeddingModelProviders[embeddingModelProvider]
          ) {
            embeddingModelProvider = Object.keys(embeddingModelProviders)[0];
            localStorage.setItem(
              'embeddingModelProvider',
              embeddingModelProvider,
            );
          }

          if (
            embeddingModelProvider &&
            !embeddingModelProviders[embeddingModelProvider][embeddingModel]
          ) {
            embeddingModel = Object.keys(embeddingModelProviders[embeddingModelProvider])[0];
            localStorage.setItem('embeddingModel', embeddingModel);
          }
        }

        const wsURL = new URL(url);
        const searchParams = new URLSearchParams({});

        searchParams.append('chatModel', chatModel!);
        searchParams.append('chatModelProvider', chatModelProvider);

        if (chatModelProvider === 'custom_openai') {
          searchParams.append(
            'openAIApiKey',
            localStorage.getItem('openAIApiKey')!,
          );
          searchParams.append(
            'openAIBaseURL',
            localStorage.getItem('openAIBaseURL')!,
          );
        }

        searchParams.append('embeddingModel', embeddingModel!);
        searchParams.append('embeddingModelProvider', embeddingModelProvider);

        wsURL.search = searchParams.toString();

        const ws = new WebSocket(wsURL.toString());
        wsRef.current = ws;

        const timeoutId = setTimeout(() => {
          if (ws.readyState !== 1) {
            toast.error(
              '无法连接到服务器，请稍后重试。',
            );
          }
        }, 10000);

        ws.addEventListener('message', (e) => {
          const data = JSON.parse(e.data);
          if (data.type === 'signal' && data.data === 'open') {
            const interval = setInterval(() => {
              if (ws.readyState === 1) {
                setIsWSReady(true);
                setError(false);
                if (retryCountRef.current > 0) {
                  toast.success('连接已恢复。');
                }
                retryCountRef.current = 0;
                clearInterval(interval);
              }
            }, 5);
            clearTimeout(timeoutId);
            console.debug(new Date(), 'ws:connected');
          }
          if (data.type === 'error') {
            toast.error(data.data);
          }
        });

        ws.onerror = () => {
          clearTimeout(timeoutId);
          setIsWSReady(false);
          toast.error('WebSocket 连接出错。');
        };

        ws.onclose = () => {
          clearTimeout(timeoutId);
          setIsWSReady(false);
          console.debug(new Date(), 'ws:disconnected');
          if (!isCleaningUpRef.current) {
            toast.error('连接丢失，正在尝试重连...');
            attemptReconnect();
          }
        };
      } catch (error) {
        console.debug(new Date(), 'ws:error', error);
        setIsWSReady(false);
        attemptReconnect();
      }
    };

    const attemptReconnect = () => {
      retryCountRef.current += 1;
      if (retryCountRef.current > MAX_RETRIES) {
        console.debug(new Date(), 'ws:max_retries');
        setError(true);
        toast.error(
          '多次尝试后仍无法连接服务器，请刷新页面重试。',
        );
        return;
      }
      const backoffDelay = getBackoffDelay(retryCountRef.current);
      console.debug(new Date(), `ws:retry attempt=${retryCountRef.current}/${MAX_RETRIES} delay=${backoffDelay}ms`);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        connectWs();
      }, backoffDelay);
    };

    connectWs();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close();
        isCleaningUpRef.current = true;
        console.debug(new Date(), 'ws:cleanup');
      }
    };
  }, [url, setIsWSReady, setError]);

  return wsRef.current;
};
export default useSocket;
