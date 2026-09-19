// 对外的动作集合：页面只经过这一层，项目、依赖登记与责任人转交三个模块各自管好自己的校验与落盘
const { ApiError, pickText } = require('./errors');
const projects = require('./projects');
const deps = require('./deps');
const owners = require('./owners');

// 查询参数在页面与接口之间来回传的都是文本，这里统一去掉首尾空白并兜住空值
function readQuery(query, name) {
  return pickText(query && query[name]);
}

module.exports = {
  ApiError,
  readQuery,
  ...projects,
  ...deps,
  ...owners,
};
