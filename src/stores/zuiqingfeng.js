export const zuiqingfeng = {
  key: 'zuiqingfeng',
  name: '醉清风旗舰店',
  shopId: '116576560',
  shopUrl: 'https://zuiqingfeng.tmall.com/shop/view_shop.htm?shop_id=116576560',
  expectedHosts: [
    'acs.m.taobao.com',
    'h5api.m.taobao.com',
    'market.m.taobao.com',
    'pages.tmall.com',
    'zuiqingfeng.tmall.com'
  ],
  successHints: ['SUCCESS', '签到成功', '已签到', 'success":true', 'success: true'],
  expiredHints: ['FAIL_SYS_SESSION_EXPIRED', 'Session expired', '令牌过期', '登录', 'login'],
  riskHints: ['x5sec', '验证码', '滑块', '人机验证', '安全验证', 'punish']
};

export default zuiqingfeng;
