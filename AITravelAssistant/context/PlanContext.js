import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, ToastAndroid } from 'react-native';
import { clearPlannedItems, getPlannedItems, togglePlannedItem } from '../services/backendService';

const PlanContext = createContext(null);

const showPlanToast = (message) => {
  if (!message) return;
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
    return;
  }
  if (Platform.OS !== 'web') {
    Alert.alert('Plan updated', message);
  }
};

export const PlanProvider = ({ children }) => {
  const [plan, setPlan] = useState([]);
  const [loading, setLoading] = useState(true);

  const refreshPlan = useCallback(async () => {
    try {
      const items = await getPlannedItems();
      setPlan(Array.isArray(items) ? items : []);
    } catch (error) {
      console.warn('Plan refresh failed:', error);
      setPlan([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshPlan();
  }, [refreshPlan]);

  const isPlanned = useCallback(
    (itemOrId) => {
      const targetId = typeof itemOrId === 'string' ? itemOrId : itemOrId?.id;
      if (!targetId) return false;
      return plan.some((item) => item.id === targetId);
    },
    [plan]
  );

  const togglePlanItem = useCallback(
    async (item, { toast = false } = {}) => {
      const result = await togglePlannedItem(item);
      const nextItems = Array.isArray(result?.items) ? result.items : [];
      setPlan(nextItems);
      if (toast) {
        showPlanToast(result?.saved ? 'Added to your plan' : 'Removed from your plan');
      }
      return result;
    },
    []
  );

  const addToPlan = useCallback(
    async (item, { toast = true } = {}) => {
      if (!item?.id) {
        return { saved: false, items: plan };
      }
      if (isPlanned(item.id)) {
        if (toast) {
          showPlanToast('Already in your plan');
        }
        return { saved: true, items: plan, alreadySaved: true };
      }
      return togglePlanItem(item, { toast });
    },
    [isPlanned, plan, togglePlanItem]
  );

  const removeFromPlan = useCallback(
    async (item, { toast = false } = {}) => {
      if (!item?.id || !isPlanned(item.id)) {
        return { saved: false, items: plan };
      }
      return togglePlanItem(item, { toast });
    },
    [isPlanned, plan, togglePlanItem]
  );

  const clearPlan = useCallback(async () => {
    try {
      await clearPlannedItems();
    } catch (error) {
      console.warn('Plan clear failed:', error);
    } finally {
      setPlan([]);
    }
  }, []);

  const value = useMemo(
    () => ({
      plan,
      loading,
      refreshPlan,
      isPlanned,
      addToPlan,
      removeFromPlan,
      togglePlanItem,
      clearPlan,
    }),
    [addToPlan, clearPlan, isPlanned, loading, plan, refreshPlan, removeFromPlan, togglePlanItem]
  );

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
};

export const usePlan = () => {
  const context = useContext(PlanContext);
  if (!context) {
    throw new Error('usePlan must be used within a PlanProvider');
  }
  return context;
};
