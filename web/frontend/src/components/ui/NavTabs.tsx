import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { HomeIcon } from '../../assets/icons/HomeIcon';
import { UpdatesIcon } from '../../assets/icons/UpdatesIcon';
import { SettingsIcon } from '../../assets/icons/SettingsIcon';

const GRADIENT =
  'linear-gradient(225deg, #06b6d4 0%, #0891b2 50%, #0e7490 100%)';

type Tab = { title: string; icon: typeof HomeIcon; path: string };

const tabs: Tab[] = [
  { title: 'Home', icon: HomeIcon, path: '/' },
  { title: 'Updates', icon: UpdatesIcon, path: '/updates' },
  { title: 'Settings', icon: SettingsIcon, path: '/' },
];

const StyledWrapper = styled.div`
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 80;
  display: flex;
  justify-content: center;
  background: rgba(11, 21, 38, 0.95);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 32px;
  padding: 8px 16px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
  @media (min-width: 768px) {
    bottom: auto;
    left: auto;
    right: 24px;
    top: 50%;
    transform: translateY(-50%);
    flex-direction: column;
    gap: 12px;
    padding: 16px 8px;
    background: rgba(11, 21, 38, 0.95);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 32px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
  }
  @media (max-width: 767px) {
    flex-direction: row;
    gap: 12px;
    padding: 8px 16px;
    align-items: center;
  }
  .tooltip-container {
    position: relative;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    @media (max-width: 767px) {
      gap: 0;
      padding: 0;
    }
    @media (min-width: 768px) {
      gap: 0;
    }
    .borde-back {
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.3s ease;
      @media (max-width: 767px) {
        width: 44px;
        height: 44px;
        border-radius: 50%;
      }
      @media (min-width: 768px) {
        width: 60px;
        height: 60px;
        border-radius: 50%;
      }
    }
    .icon {
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      background: ${GRADIENT};
      box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.1);
      @media (max-width: 767px) {
        width: 40px;
        height: 40px;
        background: transparent !important;
        box-shadow: none !important;
        outline: none;
      }
      @media (min-width: 768px) {
        width: 48px;
        height: 48px;
      }
    }
  }
  .tooltip {
    position: absolute;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 4px 8px;
    border-radius: 8px;
    font-size: 12px;
    opacity: 0;
    transition: opacity 0.3s;
    pointer-events: none;
    white-space: nowrap;
    top: -32px;
    &.visible {
      opacity: 1;
    }
  }
  .label {
    font-size: 10px;
    margin-top: 4px;
    transition: color 0.3s;
  }
`;

export default function NavTabs() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathTab = location.pathname === '/updates' ? 'updates' : 'home';
  const [activeTab, setActiveTab] = useState(pathTab);
  const [tooltipTab, setTooltipTab] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setActiveTab(pathTab);
  }, [pathTab]);

  const showTooltip = useCallback((title: string) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setTooltipTab(title);
  }, []);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setTooltipTab(null), 1500);
  }, []);

  const go = (tab: Tab) => {
    setActiveTab(tab.title.toLowerCase());
    navigate(tab.path);
  };

  const handleTap = (tab: Tab) => {
    showTooltip(tab.title);
    scheduleHide();
    go(tab);
  };

  return (
    <StyledWrapper>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.title.toLowerCase();
        const isTooltip = tooltipTab === tab.title;
        const iconColor = isActive ? '#22d3ee' : '#64748b';
        const Icon = tab.icon;

        return (
          <div
            key={tab.title}
            className={`tooltip-container ${isActive ? 'active' : ''}`}
            onMouseEnter={() => showTooltip(tab.title)}
            onMouseLeave={scheduleHide}
          >
            <span className={`tooltip ${isTooltip ? 'visible' : ''}`}>
              {tab.title}
            </span>
            <div className="borde-back">
              <div
                className="icon"
                style={{
                  background: isActive ? GRADIENT : 'transparent',
                  boxShadow: isActive ? '0 0 20px rgba(6,182,212,0.5)' : 'none',
                }}
                onClick={() => handleTap(tab)}
              >
                <Icon color={iconColor} />
              </div>
            </div>
            <span
              className="label"
              style={{ color: isActive ? '#22d3ee' : '#64748b' }}
            >
              {tab.title}
            </span>
          </div>
        );
      })}
    </StyledWrapper>
  );
}
