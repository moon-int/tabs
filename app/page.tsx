"use client";
import React from 'react';
import TabsHome from '../components/home/TabsHome';
import JamHome from '../components/home/JamHome';
import { isJam } from '../lib/brand';

/** the home page: tabs by mo-tion (public) or jam, the band's own room (TABS_BRAND=jam) */
export default function Home() {
  return isJam ? <JamHome /> : <TabsHome />;
}
