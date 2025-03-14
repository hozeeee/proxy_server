

### device_list.json 说明

1. 第一个必定是本地调试，不能动。
2. `update_test` 尽量不要改，如果改，需要连同 forward_end 也要同步改动。
3. 如果是本地调试，改动了此配置文件，需要运行 `npm run update:my_controller` 来更新 controller 。
