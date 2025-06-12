import { Chat } from './chat';
import Image from 'next/image';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-4 sm:px-6 lg:px-8 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-center">
          <Image
            src="/name.jpeg"
            alt="SwarmSync Logo"
            width={113}
            height={24}
            className="w-[113px] h-auto"
          />
        </div>
      </header>

      <div className="px-4 sm:px-6 lg:px-8 pt-8 pb-6">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-[2.5rem] lg:text-[3.8rem] text-[#36322F] dark:text-white font-semibold tracking-tight leading-[0.9] animate-fade-up [animation-duration:500ms] [animation-delay:200ms] [animation-fill-mode:forwards]">
            <span className="relative px-1 text-transparent bg-clip-text bg-gradient-to-tr from-blue-600 to-red-500 inline-flex justify-center items-center">
              SwarmSync
            </span>
            <span className="block leading-[1.1] animate-fade-up [animation-duration:500ms] [animation-delay:400ms] [animation-fill-mode:forwards]">
              Deep Research
            </span>
          </h1>
        </div>
      </div>

      <div className="flex-1">
        <Chat />
      </div>
    </div>
  );
}